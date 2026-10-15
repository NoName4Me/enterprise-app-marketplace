import type { Actor } from "@/domain/actor";
import { getAssets } from "@/domain/asset-service";
import { parseArgoApplications, type ArgoOverview, type EnvironmentIdentity } from "./argocd-model";

function endpoint(): URL | null {
  const raw = process.env.ARGOCD_SERVER_URL?.trim();
  if (!raw || !process.env.ARGOCD_READ_TOKEN?.trim()) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "argocd-server.argocd.svc.cluster.local"].includes(url.hostname))) return null;
    return url;
  } catch {
    return null;
  }
}
function permittedProjects(): ReadonlySet<string> {
  return new Set((process.env.ARGOCD_ALLOWED_PROJECTS ?? "").split(",")
    .map(item => item.trim()).filter(item => /^[a-z0-9][-a-z0-9.]{0,119}$/.test(item)));
}

/** P4 read-only: authorization happens before any Argo call. No cluster credentials reach the client. */
export async function getArgoOverview(actor: Actor | null, appId: string, admin = false): Promise<ArgoOverview> {
  const assets = await getAssets(actor, appId, admin);
  const environments: EnvironmentIdentity[] = assets.environments
    .filter(env => !env.archivedAt)
    .map(env => ({ id: env.id, key: env.key, name: env.name }));
  const observedAt = new Date().toISOString();
  const base = { source: "Argo CD Applications API" as const, observedAt, environments,
    applications: [], truncated: false, dashboardUrl: null };
  const server = endpoint();
  // A Kubernetes-only FQDN must not be returned as a browser-facing dashboard link.
  const dashboardUrl = server && !server.hostname.endsWith(".svc.cluster.local") ? server.toString() : null;
  const projects = permittedProjects();
  if (!server || !projects.size) return { ...base, state: "NOT_CONNECTED" };
  if (!environments.length) return { ...base, state: "OK", dashboardUrl };
  try {
    const url = new URL(server.toString());
    url.pathname = url.pathname.replace(/\/$/, "") + "/api/v1/applications";
    url.searchParams.set("selector", "marketplace-app-id=" + appId);
    // Always query the fixed operator-configured endpoint. No user URL or redirect is followed.
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + process.env.ARGOCD_READ_TOKEN!.trim(),
        "Accept": "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ...base, state: "UNKNOWN", dashboardUrl };
    const parsed: unknown = await response.json();
    const result = parseArgoApplications(parsed, appId, environments, projects);
    return { ...base, state: "OK", ...result, dashboardUrl };
  } catch {
    return { ...base, state: "UNKNOWN", dashboardUrl };
  }
}
