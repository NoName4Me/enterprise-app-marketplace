import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { codingTasks, externalReferences, appComponents, requirements } from "@/db/schema";
import { authorizeActor, type Actor } from "./actor";
import { getRequirement } from "./requirement-service";
import { AppError } from "./app-errors";

const GITHUB = "https://api.github.com";
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
function allowedRepositories() {
  return new Set((process.env.P5_ALLOWED_REPOS ?? "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean));
}
function headers() {
  const key = process.env.P5_COPILOT_USER_TOKEN?.trim();
  if (!key) throw new AppError(422, "p5_copilot_not_configured");
  return { Authorization: "Bearer " + key, Accept: "application/vnd.github+json",
    "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" };
}
async function permittedOwner(actor: Actor | null, requirementId: string) {
  const actorData = await authorizeActor(actor, "create");
  const req = await getRequirement(actor, requirementId);
  if (!req.appId || req.ownerId !== actorData.id || req.status === "DONE" || req.status === "REJECTED")
    throw new AppError(403, "coding_task_not_allowed");
  return { req, actorData };
}
async function sourceRepo(appId: string) {
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
export async function startCodingTask(actor: Actor | null, requirementId: string) {
  const { req, actorData } = await permittedOwner(actor, requirementId);
  const repo = await sourceRepo(req.appId!);
  const auth = headers();
  const [existing] = await db.select({ id: codingTasks.id }).from(codingTasks)
    .where(eq(codingTasks.requirementId, req.id)).limit(1);
  if (existing) throw new AppError(409, "coding_task_exists");
  // Persist the in-flight state first: a timed-out remote request is UNKNOWN,
  // not a reason to silently create a second Coding Agent task.
  const [created] = await db.insert(codingTasks).values({
    requirementId: req.id, createdBy: actorData.id, repository: repo,
  }).onConflictDoNothing().returning({ id: codingTasks.id });
  if (!created) throw new AppError(409, "coding_task_exists");
  const prompt = [
    "Implement this approved-for-investigation requirement in the existing repository.",
    "Read AGENTS.md and relevant code first. Work on a new branch based on dev.",
    "Run appropriate checks and open a PR to dev; do not merge or deploy.",
    "Never access production secrets or local Mac resources.",
    "Portal requirement ID: " + req.id,
    "Title: " + req.title,
    "Type: " + req.type,
    "Description:\n" + req.description.slice(0, 3500),
  ].join("\n\n");
  try {
    const response = await fetch(GITHUB + "/agents/repos/" + repo + "/tasks", {
      method: "POST", cache: "no-store", redirect: "error",
      headers: auth,
      body: JSON.stringify({ prompt, base_ref: "dev", create_pull_request: true }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("remote_task_failed");
    const value: unknown = await response.json();
    const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const taskId = String(obj.id ?? "");
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(taskId)) throw new Error("invalid_task_identity");
    await db.update(codingTasks).set({ externalTaskId: taskId, state: "ACCEPTED", updatedAt: new Date() })
      .where(eq(codingTasks.id, created.id));
    return { id: created.id, state: "ACCEPTED", repository: repo,
      note: "GitHub 已接受编码任务。是否创建 PR、测试是否通过，仍需查询 GitHub 真实状态。" };
  } catch {
    await db.update(codingTasks).set({ state: "UNKNOWN", updatedAt: new Date() })
      .where(eq(codingTasks.id, created.id));
    return { id: created.id, state: "UNKNOWN", repository: repo,
      note: "外部任务是否创建成功未知。请在 GitHub 核对后再处理，不会自动重复派发。" };
  }
}
export async function getCodingTask(actor: Actor | null, requirementId: string) {
  await permittedOwner(actor, requirementId);
  const [record] = await db.select().from(codingTasks)
    .where(eq(codingTasks.requirementId, requirementId)).limit(1);
  if (!record) return { state: "NOT_STARTED", repository: null, externalTaskId: null,
    note: "尚未发起云端编码任务。", source: "GitHub Copilot Cloud Agent" };
  const base = { state: record.state, repository: record.repository,
    externalTaskId: record.externalTaskId, source: "GitHub Copilot Cloud Agent",
    note: record.state === "UNKNOWN" ? "曾请求云端任务但结果不明，需人工核对。" : "本地仅记录派发事实。"};
  if (!record.externalTaskId) return base;
  try {
    const response = await fetch(GITHUB + "/agents/repos/" + record.repository + "/tasks/" + record.externalTaskId,
      { headers: headers(), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("unknown_task");
    const value: unknown = await response.json();
    const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const state = typeof obj.state === "string" ? obj.state : "unknown";
    return { ...base, state, note: "GitHub 实时任务状态。任务完成不等于 PR 合并、CI 通过或部署成功。" };
  } catch { return { ...base, state: "UNKNOWN", note: "GitHub 不可达或无权限，不能断言任务完成。" }; }
}
