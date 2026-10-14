import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { applications, appComponents, appEnvironments, componentEnvironments, externalReferences, assetEvents, user } from "@/db/schema";
import { authorizeActor, type Actor } from "./actor";
import { AppError } from "./app-errors";
import { assetId, expectedVersion, validateAssetCreate, validateAssetPatch, validateTeamPatch, type AssetResource } from "./asset-validation";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const tables = { components: appComponents, environments: appEnvironments, bindings: componentEnvironments, references: externalReferences };
type AssetRow = typeof appComponents.$inferSelect | typeof appEnvironments.$inferSelect | typeof componentEnvironments.$inferSelect | typeof externalReferences.$inferSelect;

async function privateApp(tx: Transaction, actor: Actor | null, appId: string, admin: boolean, write = false) {
  // Writes acquire application then user; account administration only locks users.
  // SHARE conflicts with non-key permission updates (KEY SHARE would not).
  const [app] = await tx.select().from(applications).where(eq(applications.id, appId)).for(write ? "update" : "share");
  if (actor) await tx.select({ id: user.id }).from(user).where(eq(user.id, actor.id)).for("share");
  const current = await authorizeActor(actor, admin ? "review" : "active", tx);
  if (!app || (!admin && app.ownerUserId !== current.id)) throw new AppError(404, "not_found");
  if (write) {
    await authorizeActor(actor, "create", tx);
    if (app.lifecycleStatus === "RETIRED") throw new AppError(409, "asset_read_only");
  }
  return app;
}

export async function getAssets(actor: Actor | null, appId: string, admin = false) {
  await authorizeActor(actor, admin ? "review" : "active");
  assetId(appId);
  // Root SHARE prevents asset writers from changing any child until aggregate read ends.
  return db.transaction(async tx => {
    const app = await privateApp(tx, actor, appId, admin);
    const components = await tx.select().from(appComponents).where(eq(appComponents.appId, appId)).orderBy(asc(appComponents.key));
    const environments = await tx.select().from(appEnvironments).where(eq(appEnvironments.appId, appId)).orderBy(asc(appEnvironments.key));
    const bindings = await tx.select().from(componentEnvironments).where(eq(componentEnvironments.appId, appId)).orderBy(asc(componentEnvironments.id));
    const references = await tx.select().from(externalReferences).where(eq(externalReferences.appId, appId)).orderBy(asc(externalReferences.id));
    return { id: appId, assetVersion: app.assetVersion, lifecycleStatus: app.lifecycleStatus, responsibleTeamName: app.responsibleTeamName, components, environments, bindings,
      references: references.map(reference => ({ ...reference, connectionStatus: "NOT_VERIFIED", lastCollectedAt: null,
        // A workflow numeric ID is an API object identity, not a workflow filename.
        url: `https://github.com/${reference.repositoryFullName}${reference.resourceKind === "WORKFLOW" ? "/actions" : ""}`,
      })), healthStatus: "NOT_CONNECTED", deploymentStatus: "NOT_CONNECTED" };
  });
}
export async function getAssetEvents(actor: Actor | null, appId: string, admin = false, beforeVersion?: number) {
  await authorizeActor(actor, admin ? "review" : "active");
  assetId(appId);
  if (beforeVersion !== undefined && (!Number.isInteger(beforeVersion) || beforeVersion < 1)) throw new AppError(422, "invalid_cursor");
  return db.transaction(async tx => {
    await privateApp(tx, actor, appId, admin);
    const items = await tx.select().from(assetEvents).where(and(eq(assetEvents.appId, appId), beforeVersion === undefined ? undefined : sql`${assetEvents.assetVersionAfter} < ${beforeVersion}`))
      .orderBy(desc(assetEvents.assetVersionAfter)).limit(50);
    return { items, nextBeforeVersion: items.length === 50 ? items[49].assetVersionAfter : null };
  });
}
function auditState(row: AssetRow | null) {
  if (!row) return null;
  // Deliberate whitelist: notes/names/repository text are private mutable content,
  // not needed to prove identities, relationships, archives and version history.
  return { id: row.id, archived: row.archivedAt !== null,
    ...("componentId" in row ? { componentId: row.componentId } : {}),
    ...("environmentId" in row ? { environmentId: row.environmentId } : {}),
    ...("bindingId" in row ? { bindingId: row.bindingId } : {}),
    ...("purpose" in row ? { purpose: row.purpose } : {}),
    ...("resourceKind" in row ? { resourceKind: row.resourceKind, workflowId: row.workflowId } : {}),
  };
}
async function parent(tx: Transaction, resource: "components" | "environments" | "bindings", appId: string, id: string) {
  const table = tables[resource];
  const [row] = await tx.select().from(table).where(and(eq(table.appId, appId), eq(table.id, id))).limit(1);
  if (!row) throw new AppError(404, "not_found");
  if (row.archivedAt) throw new AppError(409, "parent_archived");
  return row;
}
async function checkParents(tx: Transaction, appId: string, row: AssetRow | ReturnType<typeof validateAssetCreate>) {
  if ("componentId" in row && row.componentId) await parent(tx, "components", appId, row.componentId);
  if ("environmentId" in row && row.environmentId) await parent(tx, "environments", appId, row.environmentId);
  if ("bindingId" in row && row.bindingId) {
    const binding = await parent(tx, "bindings", appId, row.bindingId);
    if (!("componentId" in binding) || binding.componentId !== row.componentId) throw new AppError(404, "not_found");
    if ("environmentId" in binding) await parent(tx, "environments", appId, binding.environmentId);
  }
}
async function checkArchive(tx: Transaction, resource: AssetResource, appId: string, id: string) {
  if (resource === "components" || resource === "environments") {
    const [binding] = await tx.select({ id: componentEnvironments.id }).from(componentEnvironments).where(and(eq(componentEnvironments.appId, appId), isNull(componentEnvironments.archivedAt), eq(resource === "components" ? componentEnvironments.componentId : componentEnvironments.environmentId, id))).limit(1);
    if (binding) throw new AppError(409, "active_dependencies");
  }
  if (resource !== "references") {
    let predicate;
    if (resource === "environments") {
      const bindings = await tx.select({ id: componentEnvironments.id }).from(componentEnvironments).where(and(eq(componentEnvironments.appId, appId), eq(componentEnvironments.environmentId, id)));
      // Active references to even an archived binding must prevent parent archive.
      predicate = bindings.length ? or(...bindings.map(b => eq(externalReferences.bindingId, b.id))) : sql`false`;
    } else predicate = eq(resource === "components" ? externalReferences.componentId : externalReferences.bindingId, id);
    const [reference] = await tx.select({ id: externalReferences.id }).from(externalReferences).where(and(eq(externalReferences.appId, appId), isNull(externalReferences.archivedAt), predicate)).limit(1);
    if (reference) throw new AppError(409, "active_dependencies");
  }
}
function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseCode(error.cause) : undefined;
}
async function writeAsset(actor: Actor | null, appId: string, body: Record<string, unknown>, operation: (tx: Transaction) => Promise<{ resourceType: AssetResource | "application"; resourceId: string; action: "CREATED" | "UPDATED" | "ARCHIVED" | "RESTORED"; before: unknown; after: unknown; result: unknown }>) {
  await authorizeActor(actor, "active"); assetId(appId);
  const version = expectedVersion(body);
  try {
    return await db.transaction(async tx => {
      const app = await privateApp(tx, actor, appId, false, true);
      if (app.assetVersion !== version) throw new AppError(409, "asset_version_conflict");
      const change = await operation(tx);
      await tx.update(applications).set({ assetVersion: version + 1, updatedAt: new Date() }).where(eq(applications.id, appId));
      await tx.insert(assetEvents).values({ appId, actorUserId: actor!.id, action: change.action, resourceType: change.resourceType, resourceId: change.resourceId, beforeState: change.before, afterState: change.after, assetVersionAfter: version + 1 });
      return { assetVersion: version + 1, resource: change.result };
    });
  } catch (error) {
    if (databaseCode(error) === "23505") throw new AppError(409, "duplicate_asset");
    throw error;
  }
}
export async function updateAssetTeam(actor: Actor | null, appId: string, body: Record<string, unknown>) {
  return writeAsset(actor, appId, body, async tx => {
    const responsibleTeamName = validateTeamPatch(body);
    const [before] = await tx.select({ responsibleTeamName: applications.responsibleTeamName }).from(applications).where(eq(applications.id, appId));
    if (before.responsibleTeamName === responsibleTeamName) throw new AppError(409, "asset_unchanged");
    await tx.update(applications).set({ responsibleTeamName }).where(eq(applications.id, appId));
    return { resourceType: "application", resourceId: appId, action: "UPDATED", before: { teamAssigned: before.responsibleTeamName !== null }, after: { teamAssigned: responsibleTeamName !== null }, result: { responsibleTeamName } };
  });
}
export async function createAsset(actor: Actor | null, appId: string, resource: AssetResource, body: Record<string, unknown>) {
  return writeAsset(actor, appId, body, async tx => {
    const input = validateAssetCreate(resource, body);
    await checkParents(tx, appId, input);
    let row: AssetRow;
    switch (input.kind) {
      case "components": { const { kind, ...values } = input; void kind; [row] = await tx.insert(appComponents).values({ appId, ...values }).returning(); break; }
      case "environments": { const { kind, ...values } = input; void kind; [row] = await tx.insert(appEnvironments).values({ appId, ...values }).returning(); break; }
      case "bindings": { const { kind, ...values } = input; void kind; [row] = await tx.insert(componentEnvironments).values({ appId, ...values }).returning(); break; }
      case "references": { const { kind, ...values } = input; void kind; [row] = await tx.insert(externalReferences).values({ appId, ...values }).returning(); break; }
    }
    return { resourceType: resource, resourceId: row.id, action: "CREATED", before: null, after: auditState(row), result: row };
  });
}
export async function updateAsset(actor: Actor | null, appId: string, resource: AssetResource, id: string, body: Record<string, unknown>) {
  assetId(id);
  return writeAsset(actor, appId, body, async tx => {
    const table = tables[resource];
    const [before] = await tx.select().from(table).where(and(eq(table.appId, appId), eq(table.id, id))).limit(1);
    if (!before) throw new AppError(404, "not_found");
    const patch = validateAssetPatch(resource, body);
    if (patch.archived !== undefined) {
      if (patch.archived === (before.archivedAt !== null)) throw new AppError(409, "asset_unchanged");
      if (patch.archived) await checkArchive(tx, resource, appId, id);
      else await checkParents(tx, appId, before);
    } else {
      if (before.archivedAt) throw new AppError(409, "asset_read_only");
      if (Object.entries(patch).every(([key, value]) => before[key as keyof typeof before] === value)) throw new AppError(409, "asset_unchanged");
    }
    const { archived, ...values } = patch;
    const [after] = await tx.update(table).set({ ...values, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }), updatedAt: new Date() }).where(eq(table.id, id)).returning();
    return { resourceType: resource, resourceId: id, action: archived === undefined ? "UPDATED" : archived ? "ARCHIVED" : "RESTORED", before: { ...auditState(before), changedFields: Object.keys(patch) }, after: { ...auditState(after), changedFields: Object.keys(patch) }, result: after };
  });
}
