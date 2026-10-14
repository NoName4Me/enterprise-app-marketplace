import { getArgoOverview } from "./argocd-overview";
import { getGithubOverview } from "./github-overview";
import type { Actor } from "./actor";
import type { ArgoOverview } from "./argocd-model";

export type SignalState = "OK" | "NOT_CONNECTED" | "UNKNOWN";
export type ObservedMetric = { name: string; value: number; sampledAt: string | null; revision?: string };
export type LogEntry = { at: string | null; line: string };
export type AlertEntry = { name: string; severity: string; state: string; activeAt: string | null; summary: string };
export type Signal<T> = {
  source: string;
  state: SignalState;
  observedAt: string;
  items: T[];
  scope: string | null;
};
export type DevopsEvidence = {
  source: "P4 read-only external evidence";
  collectedAt: string;
  argo: ArgoOverview;
  github: Awaited<ReturnType<typeof getGithubOverview>>;
  metrics: Signal<ObservedMetric>;
  logs: Signal<LogEntry>;
  alerts: Signal<AlertEntry>;
  scopeNote: string;
};

function configuredEndpoint(key: string): URL | null {
  const value = process.env[key]?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === "https:") return url;
    // Only trusted, explicitly configured local endpoints may use HTTP.
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url;
    return null;
  } catch { return null; }
}
async function readJson(server: URL, path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(server.toString());
  url.pathname = url.pathname.replace(/\/$/, "") + path;
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(6500),
  });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 131072)
    throw new Error("unavailable_provider");
  const text = await response.text();
  if (text.length > 131072) throw new Error("provider_response_too_large");
  return JSON.parse(text) as unknown;
}
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function arr(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function isoEpoch(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const metricQueries = [
  { name: "active_release", query: (ns: string) => 'marketplace_lab_info{namespace="' + ns + '"}' },
  { name: "active_lab_health", query: (ns: string) => 'min(marketplace_lab_health{namespace="' + ns + '"})' },
  { name: "namespace_ready_pods", query: (ns: string) => 'sum(kube_pod_status_ready{namespace="' + ns + '",condition="true"})' },
  { name: "namespace_container_restarts", query: (ns: string) => 'sum(kube_pod_container_status_restarts_total{namespace="' + ns + '"})' },
];
export async function collectDevopsEvidence(actor: Actor | null, appId: string, admin = false): Promise<DevopsEvidence> {
  const [argo, github] = await Promise.all([
    getArgoOverview(actor, appId, admin),
    getGithubOverview(actor, appId, admin),
  ]);
  const collectedAt = new Date().toISOString();
  const prom = configuredEndpoint("PROMETHEUS_SERVER_URL");
  const loki = configuredEndpoint("LOKI_SERVER_URL");
  const emptyMetrics: Signal<ObservedMetric> = {
    source: "Prometheus query API", state: prom ? "UNKNOWN" : "NOT_CONNECTED",
    observedAt: collectedAt, items: [], scope: null,
  };
  const emptyAlerts: Signal<AlertEntry> = {
    source: "Prometheus alerts API", state: prom ? "UNKNOWN" : "NOT_CONNECTED",
    observedAt: collectedAt, items: [], scope: null,
  };
  const emptyLogs: Signal<LogEntry> = {
    source: "Loki query_range API", state: loki ? "UNKNOWN" : "NOT_CONNECTED",
    observedAt: collectedAt, items: [], scope: null,
  };
  // P4 lab: one Argo Application in a dedicated namespace; avoid namespace-wide
  // queries in a shared namespace (they would expose unrelated applications).
  const allowedNamespace = process.env.P4_MONITORED_NAMESPACE || "marketplace-lab";
  const matching = argo.state === "OK"
    ? argo.applications.filter(item => item.namespace === allowedNamespace && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(item.namespace))
    : [];
  const ns = matching.length === 1 ? matching[0].namespace : null;
  if (!ns) return {
    source: "P4 read-only external evidence", collectedAt, argo, github,
    metrics: emptyMetrics, logs: emptyLogs, alerts: emptyAlerts,
    scopeNote: "没有恰好一条映射到专用实验命名空间的 Argo 应用，跳过命名空间聚合指标和日志，避免混入其他应用。",
  };
  const metrics: Signal<ObservedMetric> = { ...emptyMetrics, scope: ns };
  const logs: Signal<LogEntry> = { ...emptyLogs, scope: ns };
  const alerts: Signal<AlertEntry> = { ...emptyAlerts, scope: ns };
  await Promise.all([
    (async () => {
      if (!prom) return;
      try {
        const all = await Promise.all(metricQueries.map(metric =>
          readJson(prom, "/api/v1/query", { query: metric.query(ns) })));
        const items: ObservedMetric[] = [];
        for (let i = 0; i < all.length; i++) {
          const result = obj(all[i]);
          if (result.status !== "success") throw new Error("bad_query_status");
          const series = arr(obj(result.data).result);
          if (metricQueries[i].name === "active_release" && series.length !== 1) continue;
          const revision = String(obj(obj(series[0]).metric).revision || "");
          const sample = arr(obj(series[0]).value);
          if (sample.length !== 2) continue;
          const value = Number(sample[1]);
          if (Number.isFinite(value)) items.push({ name: metricQueries[i].name, value, sampledAt: isoEpoch(sample[0]),
            ...(metricQueries[i].name === "active_release" && (/^[a-f0-9]{40}$/.test(revision) || revision === "local") ? { revision } : {}) });
        }
        metrics.items = items;
        metrics.state = items.length ? "OK" : "UNKNOWN";
      } catch { metrics.state = "UNKNOWN"; }
    })(),
    (async () => {
      if (!prom) return;
      try {
        const payload = obj(await readJson(prom, "/api/v1/alerts", {}));
        if (payload.status !== "success") throw new Error("bad_prometheus_alerts");
        alerts.items = arr(obj(payload.data).alerts).filter(value =>
          obj(obj(value).labels).namespace === ns).slice(0, 16).map(value => {
          const row = obj(value), labels = obj(row.labels), annotations = obj(row.annotations);
          const activeAt = typeof row.activeAt === "string" && !Number.isNaN(Date.parse(row.activeAt)) ? row.activeAt : null;
          return {
            name: String(labels.alertname ?? "unknown").slice(0, 100),
            severity: String(labels.severity ?? "unknown").slice(0, 30),
            state: String(row.state ?? "unknown").slice(0, 20),
            activeAt,
            summary: String(annotations.summary ?? "").slice(0, 300),
          };
        });
        alerts.state = "OK";
      } catch { alerts.state = "UNKNOWN"; }
    })(),
    (async () => {
      if (!loki) return;
      try {
        const payload = obj(await readJson(loki, "/loki/api/v1/query_range", {
          query: '{namespace="' + ns + '",container="lab"}',
          start: String((Date.now() - 15 * 60 * 1000) * 1000000),
          end: String(Date.now() * 1000000),
          limit: "20",
          direction: "BACKWARD",
        }));
        if (payload.status !== "success") throw new Error("bad_loki_status");
        const streams = arr(obj(payload.data).result);
        const items: LogEntry[] = [];
        for (const series of streams) for (const pair of arr(obj(series).values)) {
          const row = arr(pair);
          if (row.length !== 2 || typeof row[1] !== "string") continue;
          const n = Number(row[0]);
          items.push({
            at: Number.isFinite(n) && n > 0 ? new Date(Math.floor(n / 1000000)).toISOString() : null,
            line: row[1].slice(0, 350),
          });
          if (items.length >= 20) break;
        }
        logs.items = items.slice(0, 20);
        logs.state = "OK";
      } catch { logs.state = "UNKNOWN"; }
    })(),
  ]);
  return {
    source: "P4 read-only external evidence", collectedAt, argo, github, metrics, logs, alerts,
    scopeNote: "监控指标是独立实验命名空间聚合值；日志只取 lab 容器最近 15 分钟的有限样本。真实流量与业务恢复需另外验证。",
  };
}
