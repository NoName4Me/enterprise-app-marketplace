import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { applications, appRevisions, reviewEvents } from "@/db/schema";
import { authorizeActor, type Actor } from "./actor";
import { AppError } from "./app-errors";
import { emptyContent, validateContent, type AppContent } from "./app-validation";

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
  const content = validateContent(fields);
  return db.transaction(async (tx) => {
    const [app] = await tx.insert(applications).values({ ownerUserId: owner.id }).returning();
    const [revision] = await tx.insert(appRevisions).values({
      appId: app.id, sequence: 1, createdBy: owner.id, ...content,
    }).returning();
    return { id: app.id, revisionId: revision.id, status: revision.status };
  });
}

export async function listOwnedApplications(actor: Actor | null) {
  const owner = await authorizeActor(actor, "active");
  return db.select({
    id: applications.id, listingStatus: applications.listingStatus,
    publishedRevisionId: applications.publishedRevisionId,
  }).from(applications).where(eq(applications.ownerUserId, owner.id))
    .orderBy(desc(applications.createdAt)).limit(50);
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
  return { id: app.id, listingStatus: app.listingStatus,
    publishedRevisionId: app.publishedRevisionId,
    revisions: revisions.map((r) => ({
      id: r.id, sequence: r.sequence, status: r.status, ...contentFromRevision(r),
      submittedAt: r.submittedAt, reviewedAt: r.reviewedAt,
      rejectionReason: r.rejectionReason,
    })),
  };
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
    const [draft] = await tx.select().from(appRevisions)
      .where(and(eq(appRevisions.appId, appId), eq(appRevisions.status, "DRAFT")))
      .limit(1).for("update");
    if (!draft) throw new AppError(409, "no_editable_draft");
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
    const [revision] = await tx.select().from(appRevisions)
      .where(eq(appRevisions.id, revisionId)).for("update");
    if (!revision || revision.appId !== app.id) throw new AppError(404, "not_found");
    if (revision.status !== "PENDING") throw new AppError(409, "already_reviewed");
    if (revision.createdBy === reviewer.id) throw new AppError(403, "self_review_forbidden");

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
export async function listPublished(actor: Actor | null, term = "") {
  await authorizeActor(actor, "active");
  if (term.length > 120) throw new AppError(422, "query_too_long");
  const filters = [
    eq(applications.listingStatus, "LISTED"),
    eq(appRevisions.status, "APPROVED"),
    eq(applications.publishedRevisionId, appRevisions.id),
    eq(applications.id, appRevisions.appId),
  ];
  if (term.trim()) {
    const literal = term.trim().replace(/[\\%_]/g, "\\$&");
    filters.push(sql`${appRevisions.name} ILIKE ${"%" + literal + "%"} ESCAPE '\\'`);
  }
  return db.select(publicProjection()).from(applications)
    .innerJoin(appRevisions, eq(appRevisions.id, applications.publishedRevisionId))
    .where(and(...filters)).orderBy(desc(applications.updatedAt)).limit(50);
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
