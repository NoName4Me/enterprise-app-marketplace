import { and, desc, eq, or, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { applications, appRevisions, requirements, requirementComments, user } from "@/db/schema";
import { authorizeActor, type Actor } from "./actor";
import { AppError } from "./app-errors";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value: string) { if (!ID.test(value)) throw new AppError(404, "not_found"); return value; }
function field(value: unknown, min: number, max: number, key: string) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max)
    throw new AppError(422, "invalid_" + key);
  return value.trim();
}
function githubUrl(value: unknown, kind: "issues" | "pull") {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 400) throw new AppError(422, "invalid_link");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port ||
        !new RegExp("^/[A-Za-z0-9-]+/[A-Za-z0-9_.-]+/" + kind + "/[1-9][0-9]*$").test(url.pathname) ||
        url.search || url.hash || url.username || url.password) throw new Error("bad_url");
    return url.href;
  } catch { throw new AppError(422, "invalid_link"); }
}
function readable(row: { appId: string | null; createdBy: string; appListed: string | null }, actorId: string, role: string | null) {
  return row.appId === null || row.appListed === "LISTED" || row.createdBy === actorId || role?.split(",").includes("admin");
}
async function rowOf(requirementId: string) {
  const [row] = await db.select({
    id: requirements.id, appId: requirements.appId, createdBy: requirements.createdBy,
    type: requirements.type, title: requirements.title, description: requirements.description,
    status: requirements.status, githubIssueUrl: requirements.githubIssueUrl,
    githubPrUrl: requirements.githubPrUrl, resolution: requirements.resolution,
    createdAt: requirements.createdAt, updatedAt: requirements.updatedAt,
    appListed: applications.listingStatus, ownerId: applications.ownerUserId,
    appName: appRevisions.name, creatorName: user.name,
  }).from(requirements)
    .leftJoin(applications, eq(requirements.appId, applications.id))
    .leftJoin(appRevisions, eq(applications.publishedRevisionId, appRevisions.id))
    .innerJoin(user, eq(user.id, requirements.createdBy))
    .where(eq(requirements.id, id(requirementId))).limit(1);
  return row;
}
export async function listRequirements(actor: Actor | null) {
  const current = await authorizeActor(actor, "active");
  const rows = await db.select({
    id: requirements.id, type: requirements.type, title: requirements.title,
    status: requirements.status, appId: requirements.appId,
    createdBy: requirements.createdBy, createdAt: requirements.createdAt,
    appListed: applications.listingStatus, appName: appRevisions.name,
  }).from(requirements).leftJoin(applications, eq(requirements.appId, applications.id))
    .leftJoin(appRevisions, eq(applications.publishedRevisionId, appRevisions.id))
    .where(or(isNull(requirements.appId), eq(applications.listingStatus, "LISTED"),
      eq(requirements.createdBy, current.id)))
    .orderBy(desc(requirements.createdAt)).limit(100);
  return rows.map(({ appListed, ...row }) => ({ ...row,
    appName: appListed === "LISTED" || row.createdBy === current.id ? row.appName : null }));
}
export async function createRequirement(actor: Actor | null, body: Record<string, unknown>) {
  const current = await authorizeActor(actor, "active");
  if (Object.keys(body).some(key => !["type", "title", "description", "appId"].includes(key)))
    throw new AppError(422, "unknown_field");
  const type = body.type;
  if (type !== "NEW_APP" && type !== "FEATURE" && type !== "BUG" && type !== "IMPROVEMENT")
    throw new AppError(422, "invalid_type");
  const title = field(body.title, 5, 140, "title");
  const description = field(body.description, 10, 4000, "description");
  const appId = body.appId === null || body.appId === "" || body.appId === undefined ? null : id(String(body.appId));
  if (type === "NEW_APP" && appId || type !== "NEW_APP" && !appId) throw new AppError(422, "invalid_application_relation");
  if (appId) {
    const [app] = await db.select({ listed: applications.listingStatus, revision: applications.publishedRevisionId })
      .from(applications).where(eq(applications.id, appId)).limit(1);
    if (!app || app.listed !== "LISTED" || !app.revision) throw new AppError(404, "not_found");
  }
  const [created] = await db.insert(requirements).values({ createdBy: current.id, appId, type, title, description })
    .returning({ id: requirements.id });
  return { id: created.id, status: "OPEN" as const };
}
export async function getRequirement(actor: Actor | null, requirementId: string) {
  const current = await authorizeActor(actor, "active");
  const row = await rowOf(requirementId);
  if (!row || !readable(row, current.id, current.role)) throw new AppError(404, "not_found");
  const canManage = (row.appId ? row.ownerId === current.id : false) ||
    current.role?.split(",").includes("admin") === true;
  const comments = await db.select({ id: requirementComments.id, body: requirementComments.body,
    at: requirementComments.createdAt, authorName: user.name })
    .from(requirementComments).innerJoin(user, eq(user.id, requirementComments.userId))
    .where(eq(requirementComments.requirementId, row.id))
    .orderBy(requirementComments.createdAt).limit(100);
  return { ...row, appName: row.appListed === "LISTED" || canManage || row.createdBy === current.id ? row.appName : null,
    canManage, comments };
}
export async function commentRequirement(actor: Actor | null, requirementId: string, body: Record<string, unknown>) {
  const current = await authorizeActor(actor, "active");
  if (Object.keys(body).some(key => key !== "body")) throw new AppError(422, "unknown_field");
  const content = field(body.body, 1, 2000, "body");
  await getRequirement(actor, requirementId);
  const [comment] = await db.insert(requirementComments).values({ requirementId: id(requirementId),
    userId: current.id, body: content }).returning({ id: requirementComments.id });
  return { id: comment.id };
}
export async function updateRequirement(actor: Actor | null, requirementId: string, body: Record<string, unknown>) {
  const current = await authorizeActor(actor, "active");
  if (Object.keys(body).some(key => !["status","githubIssueUrl","githubPrUrl","resolution"].includes(key)))
    throw new AppError(422, "unknown_field");
  const status = body.status;
  if (status !== "OPEN" && status !== "IN_PROGRESS" && status !== "DONE" && status !== "REJECTED")
    throw new AppError(422, "invalid_status");
  const resolution = body.resolution === "" || body.resolution == null ? null : field(body.resolution, 5, 2000, "resolution");
  if ((status === "DONE" || status === "REJECTED") && !resolution) throw new AppError(422, "resolution_required");
  return db.transaction(async tx => {
    const [row] = await tx.select({ id: requirements.id, appId: requirements.appId })
      .from(requirements).where(eq(requirements.id, id(requirementId))).for("update");
    if (!row) throw new AppError(404, "not_found");
    if (row.appId) {
      const [app] = await tx.select({ owner: applications.ownerUserId }).from(applications)
        .where(eq(applications.id, row.appId)).limit(1);
      if (app?.owner !== current.id && !current.role?.split(",").includes("admin"))
        throw new AppError(403, "forbidden");
    } else if (!current.role?.split(",").includes("admin")) throw new AppError(403, "forbidden");
    const [updated] = await tx.update(requirements).set({
      status, githubIssueUrl: githubUrl(body.githubIssueUrl, "issues"),
      githubPrUrl: githubUrl(body.githubPrUrl, "pull"), resolution, updatedAt: new Date(),
    }).where(eq(requirements.id, row.id)).returning({ id: requirements.id, status: requirements.status });
    return updated;
  });
}
