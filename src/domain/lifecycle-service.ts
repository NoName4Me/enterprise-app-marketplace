import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { applications, appRevisions, appComponents, appEnvironments, componentEnvironments, externalReferences, assetEvents, user } from "@/db/schema";
import { authorizeActor, type Actor } from "./actor";
import { AppError } from "./app-errors";
import { assetId } from "./asset-validation";
import { lifecycleTransitions, validateGovernance, type Lifecycle } from "./lifecycle-validation";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function application(tx: Transaction, actor: Actor | null, appId: string, admin: boolean, write: boolean, targetId?: string) {
  const [app] = await tx.select().from(applications).where(eq(applications.id, appId)).for(write ? "update" : "share");
  const ids = [...new Set([actor!.id, ...(targetId ? [targetId] : [])])].sort();
  await tx.select({ id: user.id }).from(user).where(inArray(user.id, ids)).orderBy(asc(user.id)).for("share");
  const current = await authorizeActor(actor, admin ? "review" : "active", tx);
  if (!app || (!admin && app.ownerUserId !== current.id)) throw new AppError(404, "not_found");
  if (!admin && write) await authorizeActor(actor, "create", tx);
  return app;
}
async function retirementBlockers(tx: Transaction, app: typeof applications.$inferSelect) {
  const blockers: string[] = [];
  if (app.lifecycleStatus !== "DEPRECATED") blockers.push("NOT_DEPRECATED");
  if (app.listingStatus !== "UNLISTED") blockers.push("STILL_LISTED");
  const [open] = await tx.select({ id: appRevisions.id }).from(appRevisions).where(and(eq(appRevisions.appId, app.id), inArray(appRevisions.status, ["DRAFT", "PENDING"]))).limit(1);
  if (open) blockers.push("OPEN_REVISION");
  for (const [name, table] of [["COMPONENTS", appComponents], ["ENVIRONMENTS", appEnvironments], ["BINDINGS", componentEnvironments], ["REFERENCES", externalReferences]] as const) {
    const [active] = await tx.select({ id: table.id }).from(table).where(and(eq(table.appId, app.id), isNull(table.archivedAt))).limit(1);
    if (active) blockers.push("ACTIVE_" + name);
  }
  return blockers;
}
export async function lifecyclePreflight(actor: Actor | null, appId: string, admin = false) {
  await authorizeActor(actor, admin ? "review" : "active"); assetId(appId);
  return db.transaction(async tx => {
    const app = await application(tx, actor, appId, admin, false);
    return { assetVersion: app.assetVersion, lifecycleStatus: app.lifecycleStatus, listingStatus: app.listingStatus,
      retirementBlockers: await retirementBlockers(tx, app), externalImpact: "UNKNOWN", integrationStatus: "NOT_CONNECTED", source: "PORTAL_REGISTRATION", allowedTransitions: admin ? app.lifecycleStatus === "RETIRED" ? ["DEPRECATED"] : app.lifecycleStatus === "DEPRECATED" ? ["RETIRED"] : [] : app.lifecycleStatus === "RETIRED" ? [] : lifecycleTransitions[app.lifecycleStatus] };
  });
}
export async function transitionLifecycle(actor: Actor | null, appId: string, body: Record<string, unknown>, admin = false) {
  await authorizeActor(actor, admin ? "review" : "active"); assetId(appId);
  return db.transaction(async tx => {
    const app = await application(tx, actor, appId, admin, true);
    const { version, reason } = validateGovernance(body);
    const to = body.to as Lifecycle;
    if (app.assetVersion !== version) throw new AppError(409, "asset_version_conflict");
    if (admin && to !== "RETIRED" && app.lifecycleStatus !== "RETIRED") throw new AppError(403, "owner_action_required");
    if (!admin && app.lifecycleStatus === "RETIRED") throw new AppError(403, "admin_restore_required");
    if (!lifecycleTransitions[app.lifecycleStatus].includes(to)) throw new AppError(409, "invalid_lifecycle_transition");
    if (to === "RETIRED" && (await retirementBlockers(tx, app)).length) throw new AppError(409, "retirement_blocked");
    await tx.update(applications).set({ lifecycleStatus: to, assetVersion: version + 1, updatedAt: new Date() }).where(eq(applications.id, appId));
    await tx.insert(assetEvents).values({ appId, actorUserId: actor!.id, resourceType: "application", resourceId: appId, action: "TRANSITIONED", beforeState: { lifecycleStatus: app.lifecycleStatus }, afterState: { lifecycleStatus: to, ...(to === "RETIRED" ? { impactAcknowledged: true, impactSource: "MANUAL_ATTESTATION", externalImpact: "UNKNOWN" } : {}) }, reason, assetVersionAfter: version + 1 });
    return { lifecycleStatus: to, assetVersion: version + 1 };
  });
}
export async function transferOwner(actor: Actor | null, appId: string, body: Record<string, unknown>) {
  await authorizeActor(actor, "review"); assetId(appId);
  const { version, reason } = validateGovernance(body, true);
  const targetId = body.newOwnerId as string;
  return db.transaction(async tx => {
    const app = await application(tx, actor, appId, true, true, targetId);
    if (app.assetVersion !== version) throw new AppError(409, "asset_version_conflict");
    const [target] = await tx.select().from(user).where(eq(user.id, targetId)).limit(1);
    if (!target || target.banned || target.mustChangePassword || !target.canCreateApp) throw new AppError(422, "owner_not_eligible");
    if (targetId === app.ownerUserId) throw new AppError(409, "asset_unchanged");
    const [pending] = await tx.select({ id: appRevisions.id }).from(appRevisions).where(and(eq(appRevisions.appId, appId), eq(appRevisions.status, "PENDING"))).limit(1);
    if (pending) throw new AppError(409, "pending_revision_blocks_transfer");
    await tx.update(applications).set({ ownerUserId: targetId, assetVersion: version + 1, updatedAt: new Date() }).where(eq(applications.id, appId));
    await tx.insert(assetEvents).values({ appId, actorUserId: actor!.id, resourceType: "application", resourceId: appId, action: "OWNER_TRANSFERRED", beforeState: { ownerUserId: app.ownerUserId }, afterState: { ownerUserId: targetId }, reason, assetVersionAfter: version + 1 });
    return { ownerUserId: targetId, assetVersion: version + 1 };
  });
}
