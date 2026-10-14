/** Read-only Argo CD facts. Neither GitOps sync nor health proves actual traffic. */
export type EnvironmentIdentity = { id: string; key: string; name: string };
export type ArgoApplicationObservation = {
  name: string;
  project: string;
  namespace: string;
  environmentId: string;
  environmentName: string;
  environmentKey: string;
  sync: "Synced" | "OutOfSync" | "Unknown";
  health: "Healthy" | "Progressing" | "Degraded" | "Suspended" | "Missing" | "Unknown";
  desiredRevision: string | null;
  lastSyncedRevision: string | null;
  lastSyncedAt: string | null;
  operationPhase: string | null;
  images: string[];
};
export type ArgoOverview = {
  source: "Argo CD Applications API";
  observedAt: string;
  state: "OK" | "NOT_CONNECTED" | "UNKNOWN";
  environments: EnvironmentIdentity[];
  applications: ArgoApplicationObservation[];
  truncated: boolean;
  dashboardUrl: string | null;
};

const LABEL_APP = "marketplace-app-id";
const LABEL_ENV = "marketplace-environment-id";
const MAX_ITEMS = 24;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function str(value: unknown, max = 160): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}
function timestamp(value: unknown): string | null {
  const text = str(value, 40);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}
export function parseArgoApplications(
  payload: unknown,
  appId: string,
  environments: readonly EnvironmentIdentity[],
  allowedProjects: ReadonlySet<string>,
): { applications: ArgoApplicationObservation[]; truncated: boolean } {
  const raw = record(payload).items;
  if (!Array.isArray(raw)) throw new Error("invalid_argo_list");
  const validEnvironments = new Map(environments.map(env => [env.id, env]));
  const applications: ArgoApplicationObservation[] = [];
  let total = 0;
  for (const candidate of raw) {
    const app = record(candidate);
    const meta = record(app.metadata);
    const labels = record(meta.labels);
    if (labels[LABEL_APP] !== appId) continue;
    const env = validEnvironments.get(str(labels[LABEL_ENV], 64));
    if (!env) continue;
    const spec = record(app.spec);
    const project = str(spec.project, 120);
    if (!allowedProjects.has(project)) continue;
    const name = str(meta.name, 253);
    if (!name || !/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(name)) continue;
    total++;
    if (applications.length >= MAX_ITEMS) continue;
    const status = record(app.status);
    const sync = record(status.sync);
    const health = record(status.health);
    const operation = record(status.operationState);
    const summary = record(status.summary);
    const history = Array.isArray(status.history) ? status.history : [];
    const last = history.length ? record(history[history.length - 1]) : {};
    const syncValue = str(sync.status);
    const healthValue = str(health.status);
    applications.push({
      name,
      project,
      namespace: str(record(spec.destination).namespace, 120),
      environmentId: env.id,
      environmentName: env.name,
      environmentKey: env.key,
      sync: syncValue === "Synced" || syncValue === "OutOfSync" ? syncValue : "Unknown",
      health: ["Healthy", "Progressing", "Degraded", "Suspended", "Missing"].includes(healthValue)
        ? healthValue as ArgoApplicationObservation["health"] : "Unknown",
      desiredRevision: str(sync.revision || (Array.isArray(sync.revisions) ? sync.revisions[0] : null), 100) || null,
      lastSyncedRevision: str(last.revision, 100) || null,
      lastSyncedAt: timestamp(last.deployedAt),
      operationPhase: str(operation.phase, 60) || null,
      images: Array.isArray(summary.images)
        ? summary.images.filter((item): item is string => typeof item === "string").slice(0, 5).map(item => item.slice(0, 220))
        : [],
    });
  }
  return { applications, truncated: total > MAX_ITEMS };
}
