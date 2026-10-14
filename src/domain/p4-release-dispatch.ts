import { authorizeActor, type Actor } from "./actor";
import { getAssets } from "./asset-service";
import { getArgoOverview } from "./argocd-overview";
import { AppError } from "./app-errors";

export async function requestLabPromotion(actor: Actor | null, appId: string, payload: Record<string, unknown>) {
  const current = await authorizeActor(actor, "create");
  const assets = await getAssets(actor, appId, false);
  const allowed = new Set((process.env.P4_DEPLOY_OPERATOR_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean));
  if (!allowed.has(current.id)) throw new AppError(403, "p4_operator_required");
  if (assets.lifecycleStatus === "RETIRED" || !assets.environments.some(env => !env.archivedAt && env.purpose === "TEST"))
    throw new AppError(422, "p4_test_environment_required");
  const argo = await getArgoOverview(actor, appId, false);
  const testEnvironmentIds = new Set(assets.environments.filter(env => !env.archivedAt && env.purpose === "TEST").map(env => env.id));
  if (argo.state !== "OK" || !argo.applications.some(item =>
    item.name === "marketplace-lab" && item.namespace === "marketplace-lab" &&
    testEnvironmentIds.has(item.environmentId)))
    throw new AppError(422, "p4_application_not_bound");
  const runId = payload.publicationRunId;
  const variant = payload.variant;
  if (typeof runId !== "string" || !/^[1-9][0-9]{0,18}$/.test(runId) ||
    (variant !== "healthy" && variant !== "unhealthy"))
    throw new AppError(422, "invalid_release_request");
  const token = process.env.P4_GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) throw new AppError(422, "p4_dispatch_not_configured");
  try {
    const response = await fetch("https://api.github.com/repos/NoName4Me/enterprise-app-marketplace/actions/workflows/p4-gitops-promote.yml/dispatches", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "master", inputs: { publication_run_id: runId, variant } }),
    });
    if (response.status !== 204) throw new Error("github_workflow_unavailable");
  } catch { throw new AppError(422, "p4_dispatch_failed"); }
  return {
    status: "DISPATCH_ACCEPTED",
    note: "GitHub 已接受工作流派发；后续仍需核实 PR、Argo 部署与实际流量切换。",
    workflowUrl: "https://github.com/NoName4Me/enterprise-app-marketplace/actions/workflows/p4-gitops-promote.yml",
  };
}
