import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { applications, appRevisions, appFavorites, appFeedback, appDiscussions, catalogEvents, user } from "@/db/schema";
import { authorizeActor, type Actor } from "./actor";
import { getPublished } from "./app-service";
import { AppError } from "./app-errors";
import { mayReviewApp } from "@/lib/access";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(id: string) { if (!uuid.test(id)) throw new AppError(404, "not_found"); }
function text(value: unknown, limit = 2000, optional = false) {
  if (typeof value !== "string" || value.trim().length > limit || (!optional && !value.trim())) throw new AppError(422, "invalid_text");
  return value.trim();
}
async function lockPublic(tx: Transaction, appId: string) {
  validId(appId);
  const [app] = await tx.select().from(applications).where(eq(applications.id, appId)).for("update");
  if (!app || app.listingStatus !== "LISTED" || !app.publishedRevisionId) throw new AppError(404, "not_found");
  const [revision] = await tx.select({ id: appRevisions.id }).from(appRevisions).where(and(
    eq(appRevisions.id, app.publishedRevisionId), eq(appRevisions.appId, appId), eq(appRevisions.status, "APPROVED"),
  )).limit(1);
  if (!revision) throw new AppError(404, "not_found");
  return app;
}

export async function getCommunity(actor: Actor | null, appId: string) {
  const current = await authorizeActor(actor, "active");
  await getPublished(actor, appId);
  const [app] = await db.select({ owner: applications.ownerUserId, featured: applications.featured }).from(applications).where(eq(applications.id, appId));
  const [favorite, feedback, discussions, stats] = await Promise.all([
    db.select({ appId: appFavorites.appId }).from(appFavorites).where(and(eq(appFavorites.appId, appId), eq(appFavorites.userId, current.id))).limit(1),
    db.select({ id: appFeedback.id, userId: appFeedback.userId, name: user.name, rating: appFeedback.rating, body: appFeedback.body,
      ownerReply: appFeedback.ownerReply, hidden: appFeedback.hidden, updatedAt: appFeedback.updatedAt }).from(appFeedback)
      .innerJoin(user, eq(user.id, appFeedback.userId)).where(and(eq(appFeedback.appId, appId), eq(appFeedback.hidden, false)))
      .orderBy(desc(appFeedback.updatedAt)).limit(100),
    db.select({ id: appDiscussions.id, userId: appDiscussions.userId, name: user.name, body: appDiscussions.body,
      parentId: appDiscussions.parentId, createdAt: appDiscussions.createdAt }).from(appDiscussions)
      .innerJoin(user, eq(user.id, appDiscussions.userId)).where(and(eq(appDiscussions.appId, appId), eq(appDiscussions.hidden, false)))
      .orderBy(desc(appDiscussions.createdAt)).limit(100),
    db.select({ rating: sql<number>`coalesce(round(avg(${appFeedback.rating}), 1), 0)::float`, count: sql<number>`count(*)::int` })
      .from(appFeedback).where(and(eq(appFeedback.appId, appId), eq(appFeedback.hidden, false))),
  ]);
  const visibleIds = new Set(discussions.filter(x => !x.parentId).map(x => x.id));
  return { saved: favorite.length > 0, featured: app.featured, isOwner: app.owner === current.id,
    canModerate: mayReviewApp(current), currentUserId: current.id, feedback, rating: stats[0].rating, ratingCount: stats[0].count,
    discussions: discussions.filter(x => !x.parentId || visibleIds.has(x.parentId)) };
}

export async function setFavorite(actor: Actor | null, appId: string, saved: unknown) {
  const current = await authorizeActor(actor, "active");
  if (typeof saved !== "boolean") throw new AppError(422, "invalid_body");
  return db.transaction(async tx => {
    await lockPublic(tx, appId);
    if (saved) await tx.insert(appFavorites).values({ appId, userId: current.id }).onConflictDoNothing();
    else await tx.delete(appFavorites).where(and(eq(appFavorites.appId, appId), eq(appFavorites.userId, current.id)));
    return { saved };
  });
}

export async function saveFeedback(actor: Actor | null, appId: string, body: Record<string, unknown>) {
  const current = await authorizeActor(actor, "active");
  if (Object.keys(body).some(k => !["rating", "body"].includes(k)) || !Number.isInteger(body.rating) || Number(body.rating) < 1 || Number(body.rating) > 5) throw new AppError(422, "invalid_rating");
  const content = text(body.body ?? "", 2000, true);
  return db.transaction(async tx => {
    await lockPublic(tx, appId);
    const [existing] = await tx.select({ hidden: appFeedback.hidden }).from(appFeedback).where(and(eq(appFeedback.appId, appId), eq(appFeedback.userId, current.id)));
    if (existing?.hidden) throw new AppError(403, "feedback_moderated");
    const [record] = await tx.insert(appFeedback).values({ appId, userId: current.id, rating: Number(body.rating), body: content })
      .onConflictDoUpdate({ target: [appFeedback.appId, appFeedback.userId], set: { rating: Number(body.rating), body: content, updatedAt: new Date(), ownerReply: null } }).returning({ id: appFeedback.id });
    return record;
  });
}

export async function addDiscussion(actor: Actor | null, appId: string, body: Record<string, unknown>) {
  const current = await authorizeActor(actor, "active");
  if (Object.keys(body).some(k => !["body", "parentId"].includes(k))) throw new AppError(422, "unknown_field");
  const content = text(body.body);
  const parentId = body.parentId == null ? null : String(body.parentId);
  if (parentId) validId(parentId);
  return db.transaction(async tx => {
    await lockPublic(tx, appId);
    if (parentId) {
      const [parent] = await tx.select().from(appDiscussions).where(and(eq(appDiscussions.id, parentId), eq(appDiscussions.appId, appId), eq(appDiscussions.hidden, false))).limit(1);
      if (!parent || parent.parentId) throw new AppError(404, "not_found");
    }
    const [record] = await tx.insert(appDiscussions).values({ appId, userId: current.id, body: content, parentId }).returning({ id: appDiscussions.id });
    return record;
  });
}

export async function manageCommunity(actor: Actor | null, appId: string, body: Record<string, unknown>) {
  const current = await authorizeActor(actor, "active");
  if (typeof body.id !== "string") throw new AppError(422, "invalid_body");
  validId(body.id);
  return db.transaction(async tx => {
    const app = await lockPublic(tx, appId);
    if (body.kind === "feedback") {
      const [record] = await tx.select().from(appFeedback).where(and(eq(appFeedback.id, String(body.id)), eq(appFeedback.appId, appId))).for("update");
      if (!record) throw new AppError(404, "not_found");
      if (body.action === "reply") {
        if (app.ownerUserId !== current.id || record.hidden) throw new AppError(403, "forbidden");
        await tx.update(appFeedback).set({ ownerReply: text(body.body) }).where(eq(appFeedback.id, record.id));
      } else if (body.action === "delete") {
        if (record.userId !== current.id) throw new AppError(403, "forbidden");
        await tx.delete(appFeedback).where(eq(appFeedback.id, record.id));
      } else if (body.action === "hide") {
        if (!mayReviewApp(current)) throw new AppError(403, "forbidden");
        const reason = text(body.reason, 500);
        await tx.update(appFeedback).set({ hidden: true }).where(eq(appFeedback.id, record.id));
        await tx.insert(catalogEvents).values({ appId, actorUserId: current.id, action: "FEEDBACK_HIDDEN", reason: `${record.id}: ${reason}` });
      } else throw new AppError(422, "invalid_body");
    } else if (body.kind === "discussion") {
      const [record] = await tx.select().from(appDiscussions).where(and(eq(appDiscussions.id, String(body.id)), eq(appDiscussions.appId, appId))).for("update");
      if (!record) throw new AppError(404, "not_found");
      if (body.action === "delete") {
        if (record.userId !== current.id) throw new AppError(403, "forbidden");
      } else if (body.action === "hide") {
        if (!mayReviewApp(current)) throw new AppError(403, "forbidden");
      } else throw new AppError(422, "invalid_body");
      const reason = body.action === "hide" ? text(body.reason, 500) : "作者删除";
      const children = await tx.select({ id: appDiscussions.id }).from(appDiscussions).where(eq(appDiscussions.parentId, record.id));
      await tx.update(appDiscussions).set({ hidden: true }).where(inArray(appDiscussions.id, [record.id, ...children.map(x => x.id)]));
      await tx.insert(catalogEvents).values({ appId, actorUserId: current.id, action: "DISCUSSION_HIDDEN", reason: `${record.id}: ${reason}` });
    } else throw new AppError(422, "invalid_body");
    return { ok: true };
  });
}

export async function manageListing(actor: Actor | null, appId: string, body: Record<string, unknown>) {
  const current = await authorizeActor(actor, "review");
  validId(appId);
  return db.transaction(async tx => {
    const [app] = await tx.select().from(applications).where(eq(applications.id, appId)).for("update");
    if (!app || !app.publishedRevisionId) throw new AppError(404, "not_found");
    if (body.action === "feature") {
      if (typeof body.featured !== "boolean" || app.listingStatus !== "LISTED") throw new AppError(422, "invalid_body");
      await tx.update(applications).set({ featured: body.featured }).where(eq(applications.id, appId));
      await tx.insert(catalogEvents).values({ appId, actorUserId: current.id, action: body.featured ? "FEATURED" : "UNFEATURED" });
    } else if (body.action === "unlist" || body.action === "relist") {
      const reason = text(body.reason, 500);
      const [revision] = await tx.select().from(appRevisions).where(and(eq(appRevisions.id, app.publishedRevisionId), eq(appRevisions.appId, appId), eq(appRevisions.status, "APPROVED")));
      if (!revision) throw new AppError(409, "no_revision");
      await tx.update(applications).set({ listingStatus: body.action === "unlist" ? "UNLISTED" : "LISTED", featured: false }).where(eq(applications.id, appId));
      await tx.insert(catalogEvents).values({ appId, actorUserId: current.id, action: body.action === "unlist" ? "UNLISTED" : "RELISTED", reason });
    } else throw new AppError(422, "invalid_body");
    return { ok: true };
  });
}
