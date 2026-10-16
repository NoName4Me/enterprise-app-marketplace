import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { applications, appRevisions, reviewEvents, appFavorites, appFeedback, appComponents, appEnvironments, componentEnvironments, externalReferences, appHostedPorts, assetEvents, appAccessRequests, requirements, appDiscussions, catalogEvents, user } from "@/db/schema";
import { authorizeActor, type Actor } from "./actor";
import { AppError } from "./app-errors";
import { validateContent, validateApplicationSource, type AppContent } from "./app-validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOr404(id: string): string {
  if (!UUID_PATTERN.test(id)) throw new AppError(404, "not_found");
  return id;
}

function contentFromRevision(row: typeof appRevisions.$inferSelect): AppContent {
  return {
    name: row.name, summary: row.summary, description: row.description,
    category: row.category, targetUrl: row.targetUrl, iconRef: row.iconRef,
  };
}

function publicProjection() {
  return {
    id: applications.id,
    name: appRevisions.name,
    summary: appRevisions.summary,
    description: appRevisions.description,
    category: appRevisions.category,
    targetUrl: appRevisions.targetUrl,
    iconRef: appRevisions.iconRef,
  };
}

/** Create a never-public application and its first editable draft. */
export async function createApplication(actor: Actor | null, fields: Record<string, unknown>) {
  const owner = await authorizeActor(actor, "create");
  const source = validateApplicationSource(fields);
  const { sourceKind: _kind, sourceRepository: _repo, ...contentFields } = fields;
  void _kind; void _repo;
  const content = validateContent(contentFields);
  if (source.sourceKind === "HOSTED" && content.targetUrl)
    throw new AppError(422, "hosted_target_url_is_managed");
  return db.transaction(async (tx) => {
    const [app] = await tx.insert(applications).values({
      ownerUserId: owner.id, sourceKind: source.sourceKind, sourceRepository: source.sourceRepository,
      // Auto-generated managed assets are a single auditable initial asset version.
      assetVersion: source.sourceKind === "HOSTED" ? 2 : 1,
    }).returning();
    const [revision] = await tx.insert(appRevisions).values({
      appId: app.id, sequence: 1, createdBy: owner.id, ...content,
    }).returning();
    if (source.sourceKind === "HOSTED") {
      // Internal assets are generated transactionally; no manual component/environment forms.
      const [component] = await tx.insert(appComponents).values({
        appId: app.id, key: "web", name: "Web 应用", notes: "平台管理",
      }).returning({ id: appComponents.id });
      const envs = await tx.insert(appEnvironments).values([
        {appId: app.id, key: "test", name: "测试环境", purpose: "TEST", notes: "平台管理"},
        {appId: app.id, key: "production", name: "生产环境", purpose: "PRODUCTION", notes: "平台管理"},
      ]).returning({ id: appEnvironments.id });
      await tx.insert(componentEnvironments).values(envs.map(env => ({
        appId: app.id, componentId: component.id, environmentId: env.id,
      })));
      await tx.insert(externalReferences).values({
        appId: app.id, componentId: component.id, resourceKind: "REPOSITORY",
        provider: "GITHUB", repositoryFullName: source.sourceRepository!,
      });
      // Serialize allocations within the existing PostgreSQL instance.
      // Kubernetes NodePort conflicts are still validated at actual deployment.
      await tx.execute(sql`select pg_advisory_xact_lock(75190061)`);
      const taken=await tx.select({port:appHostedPorts.nodePort}).from(appHostedPorts);
      const occupied=new Set(taken.map(item=>item.port));
      const free:number[]=[];
      for(let port=31000;port<=31999&&free.length<2;port++) {
        if(!occupied.has(port))free.push(port);
      }
      if(free.length!==2)throw new AppError(409,"hosted_nodeports_exhausted");
      await tx.insert(appHostedPorts).values([
        {appId:app.id,environment:"TEST",nodePort:free[0]},
        {appId:app.id,environment:"PRODUCTION",nodePort:free[1]},
      ]);
      await tx.insert(assetEvents).values({
        appId:app.id,actorUserId:owner.id,action:"CREATED",
        resourceType:"application",resourceId:app.id,assetVersionAfter:app.assetVersion,
        reason:"系统依据 GitHub 托管来源建立组件、测试/生产环境与端口预约",
      });
    }
    return { id: app.id, revisionId: revision.id, status: revision.status, sourceKind: source.sourceKind };
  });
}

export async function listOwnedApplications(actor: Actor | null) {
  const owner = await authorizeActor(actor, "active");
  const apps = await db.select({
    id: applications.id, lifecycleStatus: applications.lifecycleStatus, listingStatus: applications.listingStatus,
    publishedRevisionId: applications.publishedRevisionId, sourceKind: applications.sourceKind,
  }).from(applications).where(eq(applications.ownerUserId, owner.id))
    .orderBy(desc(applications.createdAt)).limit(50);
  if (apps.length === 0) return [];
  const revisions = await db.select({
    appId: appRevisions.appId, name: appRevisions.name,
    status: appRevisions.status, sequence: appRevisions.sequence,
  }).from(appRevisions).where(inArray(appRevisions.appId, apps.map(a => a.id)))
    .orderBy(desc(appRevisions.sequence));
  const latestByApp = new Map<string, typeof revisions[number]>();
  for (const item of revisions) {
    if (!latestByApp.has(item.appId)) latestByApp.set(item.appId, item);
  }
  return apps.map((app) => ({
    ...app, latestName: latestByApp.get(app.id)?.name || "未命名应用",
    latestStatus: latestByApp.get(app.id)?.status ?? "DRAFT",
    sequence: latestByApp.get(app.id)?.sequence ?? 1,
  }));
}

export async function getOwnedApplication(actor: Actor | null, appId: string) {
  const owner = await authorizeActor(actor, "active");
  uuidOr404(appId);
  const [app] = await db.select().from(applications).where(
    and(eq(applications.id, appId), eq(applications.ownerUserId, owner.id)),
  ).limit(1);
  if (!app) throw new AppError(404, "not_found");
  const revisions = await db.select().from(appRevisions)
    .where(eq(appRevisions.appId, app.id)).orderBy(desc(appRevisions.sequence));
  const reserved=app.sourceKind==="HOSTED"
    ? await db.select({
      environment:appHostedPorts.environment,port:appHostedPorts.nodePort,
      state:appHostedPorts.state,imageDigest:appHostedPorts.imageDigest,
      verifiedAt:appHostedPorts.verifiedAt,
    }).from(appHostedPorts).where(eq(appHostedPorts.appId,app.id)) : [];
  const ip=process.env.HOSTED_PUBLIC_IP?.trim()??"";
  const validIPv4=ip.split(".").length===4&&ip.split(".").every(segment=>
    /^[0-9]{1,3}$/.test(segment)&&Number(segment)<=255
  );
  const hostedEndpoints=reserved.map(endpoint=>({
    ...endpoint,
    url:endpoint.state==="READY"&&endpoint.verifiedAt&&validIPv4
      ? "http://"+ip+":"+endpoint.port : null,
  }));
  return { hostedEndpoints, id: app.id, lifecycleStatus: app.lifecycleStatus, listingStatus: app.listingStatus,
    sourceKind: app.sourceKind, sourceRepository: app.sourceRepository,
    publishedRevisionId: app.publishedRevisionId,
    revisions: revisions.map((r) => ({
      id: r.id, sequence: r.sequence, status: r.status, ...contentFromRevision(r),
      submittedAt: r.submittedAt, reviewedAt: r.reviewedAt,
      rejectionReason: r.rejectionReason,
    })),
  };
}

/** Hard-delete only a never-submitted draft that has no external side effects.
 *  A published app's new DRAFT revision is never eligible for this operation.
 *  Database FK restrictions provide an additional safety net for new relations.
 */
export async function deleteNewDraft(actor: Actor | null, appId: string) {
  const owner = await authorizeActor(actor, "create");
  uuidOr404(appId);
  return db.transaction(async tx => {
    const [app] = await tx.select().from(applications)
      .where(eq(applications.id, appId)).for("update");
    if (!app || app.ownerUserId !== owner.id) throw new AppError(404, "not_found");
    if (app.listingStatus !== "UNLISTED" || app.publishedRevisionId ||
      app.featured || app.lifecycleStatus !== "UNKNOWN")
      throw new AppError(409, "draft_delete_forbidden");

    const revisions = await tx.select({
      id: appRevisions.id, sequence: appRevisions.sequence, status: appRevisions.status,
      submittedAt: appRevisions.submittedAt, reviewedAt: appRevisions.reviewedAt,
    }).from(appRevisions).where(eq(appRevisions.appId, appId));
    if (revisions.length !== 1 || revisions[0].sequence !== 1 ||
      revisions[0].status !== "DRAFT" || revisions[0].submittedAt || revisions[0].reviewedAt)
      throw new AppError(409, "draft_delete_forbidden");

    // In particular, never delete workflow history, access approvals, employee
    // requests, feedback or an app that has entered a real deployment.
    const [reviews, accesses, reqs, favorites, feedback, discussions, catalog] = await Promise.all([
      tx.select({id:reviewEvents.id}).from(reviewEvents).where(eq(reviewEvents.appId, appId)),
      tx.select({id:appAccessRequests.id}).from(appAccessRequests).where(eq(appAccessRequests.appId, appId)),
      tx.select({id:requirements.id}).from(requirements).where(eq(requirements.appId, appId)),
      tx.select({userId:appFavorites.userId}).from(appFavorites).where(eq(appFavorites.appId, appId)),
      tx.select({id:appFeedback.id}).from(appFeedback).where(eq(appFeedback.appId, appId)),
      tx.select({id:appDiscussions.id}).from(appDiscussions).where(eq(appDiscussions.appId, appId)),
      tx.select({id:catalogEvents.id}).from(catalogEvents).where(eq(catalogEvents.appId, appId)),
    ]);
    if ([reviews, accesses, reqs, favorites, feedback, discussions, catalog].some(rows => rows.length))
      throw new AppError(409, "draft_delete_has_history");

    const [components, environments, bindings, refs, ports, events] = await Promise.all([
      tx.select().from(appComponents).where(eq(appComponents.appId, appId)),
      tx.select().from(appEnvironments).where(eq(appEnvironments.appId, appId)),
      tx.select().from(componentEnvironments).where(eq(componentEnvironments.appId, appId)),
      tx.select().from(externalReferences).where(eq(externalReferences.appId, appId)),
      tx.select().from(appHostedPorts).where(eq(appHostedPorts.appId, appId)),
      tx.select().from(assetEvents).where(eq(assetEvents.appId, appId)),
    ]);
    if (app.sourceKind === "EXTERNAL") {
      if (app.assetVersion !== 1 ||
        [components,environments,bindings,refs,ports,events].some(rows => rows.length))
        throw new AppError(409, "draft_delete_has_history");
    } else {
      // Only platform-created, untouched managed resources can be removed.
      const comp = components[0], envIds = new Set(environments.map(e => e.id));
      const generated = components.length === 1 && comp.key === "web" && !comp.archivedAt &&
        environments.length === 2 && environments.every(e => !e.archivedAt &&
          ((e.key === "test" && e.purpose === "TEST") ||
           (e.key === "production" && e.purpose === "PRODUCTION"))) &&
        new Set(environments.map(e => e.purpose)).size === 2 &&
        bindings.length === 2 && bindings.every(b => !b.archivedAt &&
          b.componentId === comp.id && envIds.has(b.environmentId)) &&
        new Set(bindings.map(b => b.environmentId)).size === 2 &&
        refs.length === 1 && refs[0].componentId === comp.id && !refs[0].bindingId &&
          refs[0].resourceKind === "REPOSITORY" && refs[0].repositoryFullName === app.sourceRepository &&
          !refs[0].archivedAt &&
        ports.length === 2 && ports.every(port => port.state === "RESERVED" &&
          !port.imageDigest && !port.verifiedAt) &&
        new Set(ports.map(port => port.environment)).size === 2 &&
        ports.some(port => port.environment === "TEST") &&
        ports.some(port => port.environment === "PRODUCTION");
      const auditIsInitial = app.assetVersion === 2 && events.length === 1 &&
        events[0].action === "CREATED" && events[0].resourceType === "application" &&
        events[0].resourceId === app.id && events[0].actorUserId === owner.id &&
        events[0].assetVersionAfter === 2;
      if (!generated || !auditIsInitial)
        throw new AppError(409, "draft_delete_has_history");
    }

    // Foreign-key-safe order; delete of the root app is always last.
    await tx.delete(assetEvents).where(eq(assetEvents.appId, appId));
    await tx.delete(externalReferences).where(eq(externalReferences.appId, appId));
    await tx.delete(componentEnvironments).where(eq(componentEnvironments.appId, appId));
    await tx.delete(appHostedPorts).where(eq(appHostedPorts.appId, appId));
    await tx.delete(appEnvironments).where(eq(appEnvironments.appId, appId));
    await tx.delete(appComponents).where(eq(appComponents.appId, appId));
    const [deleted] = await tx.delete(applications).where(eq(applications.id, appId))
      .returning({id:applications.id});
    if (!deleted) throw new AppError(409, "draft_delete_conflict");
    return {id:deleted.id, deleted:true};
  });
}

export async function editDraft(
  actor: Actor | null, appId: string, patch: Record<string, unknown>,
) {
  const owner = await authorizeActor(actor, "create");
  uuidOr404(appId);
  return db.transaction(async (tx) => {
    const [app] = await tx.select().from(applications)
      .where(eq(applications.id, appId)).for("update");
    if (!app || app.ownerUserId !== owner.id) throw new AppError(404, "not_found");
    if (app.lifecycleStatus === "RETIRED") throw new AppError(409, "application_retired");

    const [draft] = await tx.select().from(appRevisions)
      .where(and(eq(appRevisions.appId, appId), eq(appRevisions.status, "DRAFT")))
      .limit(1).for("update");
    if (!draft) throw new AppError(409, "no_editable_draft");
    const updated = validateContent(patch, contentFromRevision(draft));
    await tx.update(appRevisions).set(updated).where(eq(appRevisions.id, draft.id));
    return { id: app.id, revisionId: draft.id, ...updated };
  });
}

/** Supports resubmission after rejection and preserving r1 on an r2 update. */
export async function openNewDraft(actor: Actor | null, appId: string) {
  const owner = await authorizeActor(actor, "create");
  uuidOr404(appId);
  return db.transaction(async (tx) => {
    const [app] = await tx.select().from(applications)
      .where(eq(applications.id, appId)).for("update");
    if (!app || app.ownerUserId !== owner.id) throw new AppError(404, "not_found");
    if (app.lifecycleStatus === "RETIRED") throw new AppError(409, "application_retired");

    const [latest] = await tx.select().from(appRevisions)
      .where(eq(appRevisions.appId, appId))
      .orderBy(desc(appRevisions.sequence)).limit(1);
    if (!latest) throw new AppError(409, "no_revision");
    if (latest.status === "DRAFT" || latest.status === "PENDING") {
      throw new AppError(409, "active_revision_exists");
    }

    // The previous approval remains immutable even after an update is drafted.
    const [draft] = await tx.insert(appRevisions).values({
      appId, createdBy: owner.id, sequence: latest.sequence + 1,
      ...contentFromRevision(latest),
    }).returning({ id: appRevisions.id, sequence: appRevisions.sequence });
    return { id: appId, revisionId: draft.id, sequence: draft.sequence };
  });
}

export async function submitDraft(actor: Actor | null, appId: string) {
  const owner = await authorizeActor(actor, "create");
  uuidOr404(appId);
  return db.transaction(async (tx) => {
    const [app] = await tx.select().from(applications)
      .where(eq(applications.id, appId)).for("update");
    if (!app || app.ownerUserId !== owner.id) throw new AppError(404, "not_found");
    if (app.lifecycleStatus === "RETIRED") throw new AppError(409, "application_retired");
    const [draft] = await tx.select().from(appRevisions)
      .where(and(eq(appRevisions.appId, appId), eq(appRevisions.status, "DRAFT")))
      .limit(1).for("update");
    if (!draft) throw new AppError(409, "no_editable_draft");
    if (app.sourceKind === "HOSTED") throw new AppError(409, "hosted_production_not_deployed");
    validateContent({}, contentFromRevision(draft), true);
    const [submitted] = await tx.update(appRevisions).set({
      status: "PENDING", submittedAt: new Date(),
    }).where(and(eq(appRevisions.id, draft.id), eq(appRevisions.status, "DRAFT")))
      .returning({ id: appRevisions.id });
    if (!submitted) throw new AppError(409, "stale_revision");
    await tx.insert(reviewEvents).values({
      appId, revisionId: submitted.id, actorUserId: owner.id, action: "SUBMITTED",
    });
    return { id: appId, revisionId: submitted.id, status: "PENDING" as const };
  });
}

export async function listPendingReviews(actor: Actor | null) {
  await authorizeActor(actor, "review");
  return db.select({
    appId: applications.id, revisionId: appRevisions.id,
    name: appRevisions.name, summary: appRevisions.summary,
    sequence: appRevisions.sequence, createdBy: appRevisions.createdBy,
    submittedAt: appRevisions.submittedAt,
  }).from(appRevisions)
    .innerJoin(applications, eq(applications.id, appRevisions.appId))
    .where(eq(appRevisions.status, "PENDING"))
    .orderBy(appRevisions.submittedAt).limit(100);
}

/** Approval and review event are atomic. The application row serializes reviewers. */
export async function reviewRevision(
  actor: Actor | null,
  revisionId: string,
  verdict: "APPROVED" | "REJECTED",
  reason?: unknown,
) {
  const reviewer = await authorizeActor(actor, "review");
  uuidOr404(revisionId);
  if (verdict === "REJECTED" &&
      (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500)) {
    throw new AppError(422, "rejection_reason_required");
  }
  return db.transaction(async (tx) => {
    // Find appId first, then lock application before locking the revision:
    // ensures all writers use the same lock order and cannot deadlock.
    const [candidate] = await tx.select({ appId: appRevisions.appId })
      .from(appRevisions).where(eq(appRevisions.id, revisionId)).limit(1);
    if (!candidate) throw new AppError(404, "not_found");
    const [app] = await tx.select().from(applications)
      .where(eq(applications.id, candidate.appId)).for("update");
    if (!app) throw new AppError(404, "not_found");
    if (app.lifecycleStatus === "RETIRED") throw new AppError(409, "application_retired");
    await tx.select({ id: user.id }).from(user).where(eq(user.id, reviewer.id)).for("share");
    await authorizeActor(actor, "review", tx);
    const [revision] = await tx.select().from(appRevisions)
      .where(eq(appRevisions.id, revisionId)).for("update");
    if (!revision || revision.appId !== app.id) throw new AppError(404, "not_found");
    if (revision.status !== "PENDING") throw new AppError(409, "already_reviewed");
    if (revision.createdBy === reviewer.id || app.ownerUserId === reviewer.id) throw new AppError(403, "self_review_forbidden");

    const [changed] = await tx.update(appRevisions).set({
      status: verdict, reviewedBy: reviewer.id, reviewedAt: new Date(),
      rejectionReason: verdict === "REJECTED" ? (reason as string).trim() : null,
    }).where(and(eq(appRevisions.id, revision.id), eq(appRevisions.status, "PENDING")))
      .returning({ id: appRevisions.id });
    if (!changed) throw new AppError(409, "already_reviewed");

    if (verdict === "APPROVED") {
      await tx.update(applications).set({
        publishedRevisionId: revision.id, listingStatus: "LISTED", updatedAt: new Date(),
      }).where(eq(applications.id, app.id));
    }
    // If this insert fails, the entire approval and pointer switch roll back.
    await tx.insert(reviewEvents).values({
      appId: app.id, revisionId: revision.id, actorUserId: reviewer.id,
      action: verdict, reason: verdict === "REJECTED" ? (reason as string).trim() : null,
    });
    return { id: app.id, revisionId, status: verdict };
  });
}

/** Public catalog has one data source: the currently approved published pointer. */
export type CatalogOptions = { category?: string; sort?: string; saved?: boolean; page?: number; featured?: boolean };
export async function listPublished(actor: Actor | null, term = "", options: CatalogOptions = {}) {
  const current = await authorizeActor(actor, "active");
  if (term.length > 120) throw new AppError(422, "query_too_long");
  const filters = [
    eq(applications.listingStatus, "LISTED"),
    eq(appRevisions.status, "APPROVED"),
    eq(applications.publishedRevisionId, appRevisions.id),
    eq(applications.id, appRevisions.appId),
  ];
  if (term.trim()) {
    const literal = term.trim().replace(/[\\%_]/g, "\\$&");
    filters.push(or(
      sql`${appRevisions.name} ILIKE ${"%" + literal + "%"} ESCAPE '\\'`,
      sql`${appRevisions.summary} ILIKE ${"%" + literal + "%"} ESCAPE '\\'`,
    )!);
  }
  if (options.category) {
    if (!["office", "analytics", "development", "collaboration", "other"].includes(options.category)) throw new AppError(422, "invalid_category");
    filters.push(eq(appRevisions.category, options.category));
  }
  const favorites = sql<number>`(SELECT count(*)::int FROM ${appFavorites} WHERE ${appFavorites.appId} = ${applications.id})`;
  const rating = sql<number>`(SELECT coalesce(round(avg(${appFeedback.rating}), 1), 0)::float FROM ${appFeedback} WHERE ${appFeedback.appId} = ${applications.id} AND ${appFeedback.hidden} = false)`;
  const saved = sql<boolean>`EXISTS (SELECT 1 FROM ${appFavorites} WHERE ${appFavorites.appId} = ${applications.id} AND ${appFavorites.userId} = ${current.id})`;
  if (options.saved) filters.push(saved);
  if (options.featured) filters.push(eq(applications.featured, true));
  const sort = options.sort ?? "latest";
  if (!["latest", "popular", "rating", "recommended"].includes(sort)) throw new AppError(422, "invalid_sort");
  const page = options.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw new AppError(422, "invalid_page");
  return db.select({ ...publicProjection(), featured: applications.featured,
    favorites, rating, saved, publishedAt: appRevisions.reviewedAt,
    ratingCount: sql<number>`(SELECT count(*)::int FROM ${appFeedback} WHERE ${appFeedback.appId} = ${applications.id} AND ${appFeedback.hidden} = false)`,
  }).from(applications)
    .innerJoin(appRevisions, eq(appRevisions.id, applications.publishedRevisionId))
    .where(and(...filters)).orderBy(
      ...(sort === "popular" ? [desc(favorites)] : sort === "rating" ? [desc(rating)] : sort === "recommended" ? [desc(applications.featured)] : []),
      desc(appRevisions.reviewedAt), applications.id,
    ).limit(24).offset((page - 1) * 24);
}

export async function getPublished(actor: Actor | null, appId: string) {
  await authorizeActor(actor, "active");
  uuidOr404(appId);
  const [found] = await db.select(publicProjection()).from(applications)
    .innerJoin(appRevisions, eq(appRevisions.id, applications.publishedRevisionId))
    .where(and(eq(applications.id, appId),
      eq(applications.listingStatus, "LISTED"),
      eq(appRevisions.status, "APPROVED"),
      eq(appRevisions.appId, applications.id))).limit(1);
  if (!found) throw new AppError(404, "not_found");
  return found;
}

/** Private review detail: never use it as a public catalog response. */
export async function getPendingReview(actor: Actor | null, revisionId: string) {
  await authorizeActor(actor, "review");
  uuidOr404(revisionId);
  const [candidate] = await db.select({
    id: appRevisions.id,
    appId: appRevisions.appId,
    status: appRevisions.status,
    sequence: appRevisions.sequence,
    name: appRevisions.name,
    summary: appRevisions.summary,
    description: appRevisions.description,
    category: appRevisions.category,
    targetUrl: appRevisions.targetUrl,
    iconRef: appRevisions.iconRef,
    submittedAt: appRevisions.submittedAt,
    createdBy: appRevisions.createdBy,
    publishedRevisionId: applications.publishedRevisionId,
  }).from(appRevisions)
    .innerJoin(applications, eq(appRevisions.appId, applications.id))
    .where(eq(appRevisions.id, revisionId)).limit(1);
  if (!candidate || candidate.status !== "PENDING") throw new AppError(404, "not_found");
  const [previous] = candidate.publishedRevisionId
    ? await db.select({
      name: appRevisions.name, summary: appRevisions.summary,
      description: appRevisions.description, category: appRevisions.category,
      targetUrl: appRevisions.targetUrl, iconRef: appRevisions.iconRef,
    }).from(appRevisions).where(
      and(eq(appRevisions.id, candidate.publishedRevisionId),
        eq(appRevisions.appId, candidate.appId),
        eq(appRevisions.status, "APPROVED")),
    ).limit(1)
    : [];
  return { ...candidate, previous: previous ?? null };
}
