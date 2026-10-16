import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { externalReferences, appComponents } from "@/db/schema";
import { authorizeActor, type Actor } from "./actor";
import { getRequirement } from "./requirement-service";
import { AppError } from "./app-errors";

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
function allowedRepositories() {
  return new Set((process.env.P5_ALLOWED_REPOS ?? "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean));
}
export async function permittedOwner(actor: Actor | null, requirementId: string, allowClosed = false) {
  const actorData = await authorizeActor(actor, "create");
  const req = await getRequirement(actor, requirementId);
  if (!req.appId || req.ownerId !== actorData.id || (!allowClosed && (req.status === "DONE" || req.status === "REJECTED")))
    throw new AppError(403, "coding_task_not_allowed");
  return { req, actorData };
}
export async function sourceRepo(appId: string) {
  const refs = await db.select({ repo: externalReferences.repositoryFullName })
    .from(externalReferences)
    .innerJoin(appComponents, and(eq(appComponents.id, externalReferences.componentId),
      eq(appComponents.appId, externalReferences.appId)))
    .where(and(eq(externalReferences.appId, appId), eq(externalReferences.resourceKind, "REPOSITORY"),
      isNull(externalReferences.archivedAt), isNull(appComponents.archivedAt)));
  const allowed = allowedRepositories();
  const possible = [...new Set(refs.map(x => x.repo).filter(x =>
    REPO.test(x) && allowed.has(x.toLowerCase())))];
  // Requires one clear target repository; do not guess in multi-repo apps.
  if (possible.length !== 1) throw new AppError(422, "coding_repository_not_unique");
  return possible[0];
}
