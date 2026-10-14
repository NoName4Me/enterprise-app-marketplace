import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { applications, appRevisions, appAccessRequests, user } from "@/db/schema";
import { authorizeActor, type Actor } from "./actor";
import { AppError } from "./app-errors";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ensureId = (id: string) => {
  if (!uuidPattern.test(id)) throw new AppError(404, "not_found");
  return id;
};
function textField(body: Record<string, unknown>, key: string, optional = false) {
  const keys = Object.keys(body);
  if (keys.some(name => name !== key)) throw new AppError(422, "unknown_field");
  if (optional && body[key] === undefined) return null;
  if (typeof body[key] !== "string" || body[key].trim().length < 5 || body[key].trim().length > 500)
    throw new AppError(422, "invalid_" + key);
  return body[key].trim() as string;
}
function isActive(account: { banned: boolean | null; mustChangePassword: boolean } | undefined) {
  return !!account && account.banned === false && !account.mustChangePassword;
}
function isAdmin(role: string | null) {
  return role?.split(",").includes("admin") === true;
}
function canHandle(
  actor: { id: string; role: string | null },
  requesterId: string,
  ownerId: string,
  owner: { banned: boolean | null; mustChangePassword: boolean } | undefined,
) {
  if (actor.id === requesterId) return false;
  if (actor.id === ownerId && isActive(owner)) return true;
  // Admin fallback only if owner is the requester or cannot work.
  return isAdmin(actor.role) && (ownerId === requesterId || !isActive(owner));
}

export async function requestAppAccess(actor: Actor | null, appId: string, body: Record<string, unknown>) {
  const reason = textField(body, "reason");
  ensureId(appId);
  return db.transaction(async tx => {
    const [app] = await tx.select().from(applications)
      .where(eq(applications.id, appId)).for("share");
    if (actor) await tx.select({ id: user.id }).from(user).where(eq(user.id, actor.id)).for("share");
    const requester = await authorizeActor(actor, "active", tx);
    if (!app || app.listingStatus !== "LISTED" || !app.publishedRevisionId || app.lifecycleStatus === "RETIRED")
      throw new AppError(404, "not_found");
    const [published] = await tx.select({ id: appRevisions.id }).from(appRevisions)
      .where(and(eq(appRevisions.id, app.publishedRevisionId), eq(appRevisions.status, "APPROVED"))).limit(1);
    if (!published) throw new AppError(404, "not_found");
    const [created] = await tx.insert(appAccessRequests).values({
      appId, requesterUserId: requester.id, reason: reason!,
    }).onConflictDoNothing().returning({ id: appAccessRequests.id });
    if (!created) throw new AppError(409, "access_request_already_active");
    return { id: created.id, status: "PENDING" as const, provisioningStatus: "NOT_STARTED" as const };
  });
}

export async function myAppAccessRequest(actor: Actor | null, appId: string) {
  const current = await authorizeActor(actor, "active");
  ensureId(appId);
  const [row] = await db.select({
    id: appAccessRequests.id, reason: appAccessRequests.reason,
    status: appAccessRequests.status, provisioningStatus: appAccessRequests.provisioningStatus,
    decisionReason: appAccessRequests.decisionReason, provisioningNote: appAccessRequests.provisioningNote,
    createdAt: appAccessRequests.createdAt, decidedAt: appAccessRequests.decidedAt,
  }).from(appAccessRequests).where(and(
    eq(appAccessRequests.appId, appId), eq(appAccessRequests.requesterUserId, current.id),
  )).orderBy(desc(appAccessRequests.createdAt)).limit(1);
  return row ?? null;
}

export async function listMyAccessRequests(actor: Actor | null) {
  const current = await authorizeActor(actor, "active");
  return db.select({
    id: appAccessRequests.id, appId: appAccessRequests.appId, name: appRevisions.name,
    reason: appAccessRequests.reason, status: appAccessRequests.status,
    provisioningStatus: appAccessRequests.provisioningStatus,
    decisionReason: appAccessRequests.decisionReason, provisioningNote: appAccessRequests.provisioningNote,
    createdAt: appAccessRequests.createdAt,
  }).from(appAccessRequests)
    .innerJoin(applications, eq(applications.id, appAccessRequests.appId))
    .leftJoin(appRevisions, eq(appRevisions.id, applications.publishedRevisionId))
    .where(eq(appAccessRequests.requesterUserId, current.id))
    .orderBy(desc(appAccessRequests.createdAt)).limit(100);
}

export async function listAccessInbox(actor: Actor | null) {
  const current = await authorizeActor(actor, "active");
  const admin = isAdmin(current.role);
  const rows = await db.select({
    id: appAccessRequests.id, appId: appAccessRequests.appId, ownerId: applications.ownerUserId,
    requesterId: appAccessRequests.requesterUserId, name: appRevisions.name,
    reason: appAccessRequests.reason, status: appAccessRequests.status,
    provisioningStatus: appAccessRequests.provisioningStatus,
    createdAt: appAccessRequests.createdAt,
  }).from(appAccessRequests)
    .innerJoin(applications, eq(applications.id, appAccessRequests.appId))
    .leftJoin(appRevisions, eq(appRevisions.id, applications.publishedRevisionId))
    .where(and(or(
      eq(appAccessRequests.status, "PENDING"),
      and(eq(appAccessRequests.status, "APPROVED"), eq(appAccessRequests.provisioningStatus, "PENDING")),
    ), admin ? undefined : eq(applications.ownerUserId, current.id)))
    .orderBy(asc(appAccessRequests.createdAt)).limit(200);
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap(row => [row.ownerId, row.requesterId]))];
  const accounts = await db.select({
    id: user.id, name: user.name, banned: user.banned, mustChangePassword: user.mustChangePassword,
  }).from(user).where(inArray(user.id, ids));
  const lookup = new Map(accounts.map(a => [a.id, a]));
  return rows.filter(row => canHandle(current, row.requesterId, row.ownerId, lookup.get(row.ownerId)))
    .map(row => ({ ...row, requesterName: lookup.get(row.requesterId)?.name || "未知员工" }));
}

async function handleAccessRequest(
  actor: Actor | null, id: string, action: "approve" | "reject" | "provision", note: string | null,
) {
  ensureId(id);
  // Lock order: application -> involved user accounts -> request.
  return db.transaction(async tx => {
    const [candidate] = await tx.select({ appId: appAccessRequests.appId }).from(appAccessRequests)
      .where(eq(appAccessRequests.id, id)).limit(1);
    if (!candidate) throw new AppError(404, "not_found");
    const [app] = await tx.select().from(applications)
      .where(eq(applications.id, candidate.appId)).for("share");
    if (!app) throw new AppError(404, "not_found");
    const [initial] = await tx.select({ requesterId: appAccessRequests.requesterUserId })
      .from(appAccessRequests).where(eq(appAccessRequests.id, id)).limit(1);
    if (!initial) throw new AppError(404, "not_found");
    const ids = [...new Set([app.ownerUserId, initial.requesterId, ...(actor ? [actor.id] : [])])].sort();
    const accounts = await tx.select({
      id: user.id, banned: user.banned, mustChangePassword: user.mustChangePassword,
    }).from(user).where(inArray(user.id, ids)).orderBy(asc(user.id)).for("share");
    const current = await authorizeActor(actor, "active", tx);
    const [request] = await tx.select().from(appAccessRequests)
      .where(eq(appAccessRequests.id, id)).for("update");
    if (!request || request.appId !== app.id) throw new AppError(404, "not_found");
    const owner = accounts.find(account => account.id === app.ownerUserId);
    if (!canHandle(current, request.requesterUserId, app.ownerUserId, owner))
      throw new AppError(403, "access_approver_forbidden");
    if (action === "provision") {
      if (request.status !== "APPROVED" || request.provisioningStatus !== "PENDING")
        throw new AppError(409, "access_request_not_ready");
      const [changed] = await tx.update(appAccessRequests).set({
        provisioningStatus: "MANUAL_RECORDED", provisionedBy: current.id, provisionedAt: new Date(),
        provisioningNote: note!, updatedAt: new Date(),
      }).where(eq(appAccessRequests.id, id)).returning({ id: appAccessRequests.id });
      return { id: changed.id, status: "APPROVED" as const, provisioningStatus: "MANUAL_RECORDED" as const };
    }
    if (request.status !== "PENDING") throw new AppError(409, "access_request_already_decided");
    if (app.listingStatus !== "LISTED" || app.lifecycleStatus === "RETIRED")
      throw new AppError(409, "application_not_available");
    const status = action === "approve" ? "APPROVED" as const : "REJECTED" as const;
    const [changed] = await tx.update(appAccessRequests).set({
      status, decidedBy: current.id, decidedAt: new Date(),
      decisionReason: note, provisioningStatus: action === "approve" ? "PENDING" : "NOT_STARTED",
      updatedAt: new Date(),
    }).where(eq(appAccessRequests.id, id)).returning({ id: appAccessRequests.id });
    return { id: changed.id, status, provisioningStatus: action === "approve" ? "PENDING" : "NOT_STARTED" };
  });
}

export function decideAppAccess(actor: Actor | null, id: string, body: Record<string, unknown>) {
  const action = body.action;
  if (action !== "approve" && action !== "reject") throw new AppError(422, "invalid_action");
  if (Object.keys(body).some(key => key !== "action" && key !== "reason"))
    throw new AppError(422, "unknown_field");
  const reason = body.reason;
  if (action === "reject" && (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 500))
    throw new AppError(422, "invalid_reason");
  if (action === "approve" && reason !== undefined && (typeof reason !== "string" || reason.length > 500))
    throw new AppError(422, "invalid_reason");
  return handleAccessRequest(actor, id, action, typeof reason === "string" && reason.trim() ? reason.trim() : null);
}

export function recordManualProvision(actor: Actor | null, id: string, body: Record<string, unknown>) {
  const note = textField(body, "note");
  return handleAccessRequest(actor, id, "provision", note);
}
