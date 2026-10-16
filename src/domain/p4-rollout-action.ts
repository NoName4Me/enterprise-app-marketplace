import { authorizeActor, type Actor } from "./actor";
import { getAssets } from "./asset-service";
import { getArgoOverview } from "./argocd-overview";
import { AppError } from "./app-errors";

/** Uses Argo CD's built-in Rollout resource actions, not kubectl or custom traffic code. */
export async function requestLabRolloutAction(actor: Actor | null, appId: string, action: unknown) {
  const current = await authorizeActor(actor, "create");
  const assets = await getAssets(actor, appId, false);
  const allowed = new Set((process.env.P4_DEPLOY_OPERATOR_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean));
  if (!allowed.has(current.id)) throw new AppError(403, "p4_operator_required");
  if (assets.lifecycleStatus === "RETIRED") throw new AppError(422, "p4_application_retired");
  if (action !== "promote-full" && action !== "abort") throw new AppError(422, "invalid_rollout_action");
  const argo = await getArgoOverview(actor, appId);
  const ids = new Set(assets.environments.filter(env => !env.archivedAt && env.purpose === "TEST").map(env => env.id));
  const candidates = argo.applications.filter(item =>
    item.name === "marketplace-lab" && item.project === "marketplace-lab" &&
    item.namespace === "marketplace-lab" && ids.has(item.environmentId));
  if (argo.state !== "OK" || candidates.length !== 1) throw new AppError(422, "p4_application_not_bound");
  const target = candidates[0];
  if (action === "promote-full" && (target.sync !== "Synced" ||
      !["Healthy", "Progressing"].includes(target.health))) throw new AppError(422, "p4_rollout_not_ready");

  const token = process.env.ARGOCD_ACTION_TOKEN?.trim();
  const raw = process.env.ARGOCD_SERVER_URL?.trim();
  if (!token || !raw) throw new AppError(422, "p4_rollout_action_not_configured");
  let url: URL;
  try {
    url = new URL(raw);
    if (url.username || url.password || url.hash || url.search ||
      (url.protocol !== "https:" && !(url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]", "argocd-server.argocd.svc.cluster.local"].includes(url.hostname)))) throw new Error("bad_endpoint");
    url.pathname = url.pathname.replace(/\/$/, "") + "/api/v1/applications/marketplace-lab/resource/actions/v2";
  } catch { throw new AppError(422, "p4_rollout_action_not_configured"); }
  try {
    const result = await fetch(url, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "marketplace-lab", appNamespace: "argocd",
        namespace: "marketplace-lab", resourceName: "marketplace-lab",
        version: "v1alpha1", group: "argoproj.io", kind: "Rollout",
        project: "marketplace-lab", action,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!result.ok) throw new Error("argocd_action_failed");
  } catch { throw new AppError(422, "p4_rollout_action_failed"); }
  return {
    state: "ACTION_ACCEPTED",
    action,
    note: "Argo CD 接受资源动作请求；这不等于流量已经切换或回滚完成，请重新检查 Rollouts 和入口 /version。",
  };
}
