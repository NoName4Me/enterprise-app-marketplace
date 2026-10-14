import { getAssets } from "@/domain/asset-service";
import type { Actor } from "@/domain/actor";

/**
 * P1-02: live read-only GitHub context for registered asset references.
 *
 * Calls only api.github.com (never URLs supplied by users), and never returns
 * tokens or raw GitHub errors. The asset read enforces owner/admin permission.
 * This does not collect real deployment or service-health information.
 */
type SectionState = "OK" | "NOT_CONNECTED" | "UNKNOWN";
type Section<T> = { state: SectionState; items: T[] };
export type GithubCommit = { sha: string; title: string; url: string; at: string | null };
export type GithubPull = { number: number; title: string; state: "OPEN" | "CLOSED" | "MERGED"; url: string; at: string | null };
export type GithubRun = { id: number; title: string; status: string; conclusion: string | null; url: string; at: string | null };
export type GithubReference = {
  id: string;
  componentName: string;
  environmentName: string | null;
  repository: string;
  kind: "REPOSITORY" | "WORKFLOW";
  workflowId: string | null;
  source: "GitHub REST API";
  observedAt: string;
  commits: Section<GithubCommit>;
  pulls: Section<GithubPull>;
  runs: Section<GithubRun>;
};
type Cached = { until: number; data: Section<unknown> };
const cache = new Map<string, Cached>();
const MAX_CACHE = 100;
const MAX_REFS = 8;
const MAX_REPOS = 4;
const repoPattern = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i;
const workflowPattern = /^[1-9][0-9]{0,19}$/;
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown) { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function date(value: unknown): string | null {
  const candidate = text(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}
function integer(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}
function safeUrl(value: unknown, repository: string): string {
  try {
    const url = new URL(text(value));
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port ||
        !url.pathname.toLowerCase().startsWith("/" + repository.toLowerCase() + "/")) return "";
    return url.toString();
  } catch { return ""; }
}
function itemState(status: number): SectionState {
  return status === 401 || status === 404 ? "NOT_CONNECTED" : "UNKNOWN";
}
function headersFor(repository: string): Headers {
  const headers = new Headers({
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "enterprise-app-marketplace",
  });
  // Fine-grained tokens may access more repositories than a single app owner.
  // Only pass a server token for an explicitly allowed registered repository.
  const allow = (process.env.GITHUB_ALLOWED_REPOS ?? "").split(",").map(s => s.trim().toLowerCase());
  const token = process.env.GITHUB_READ_TOKEN;
  if (token && allow.includes(repository.toLowerCase())) headers.set("Authorization", "Bearer " + token);
  return headers;
}
type ResponseKind = "commits" | "pulls" | "runs";
async function readSection<T>(
  repository: string, path: string, kind: ResponseKind,
  convert: (value: unknown) => T,
): Promise<Section<T>> {
  const authenticated = headersFor(repository).has("Authorization");
  const key = (authenticated ? "credentialed" : "public") + ":" + repository + ":" + path;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.data as Section<T>;
  // Only fixed GitHub REST paths built from schema-validated references.
  let result: Section<T>;
  try {
    const response = await fetch("https://api.github.com/" + path, {
      headers: headersFor(repository), redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) {
      result = { state: itemState(response.status), items: [] };
    } else {
      const json: unknown = await response.json();
      const raw = kind === "runs" ? array(object(json).workflow_runs) : array(json);
      result = { state: "OK", items: raw.slice(0, 3).map(convert) };
    }
  } catch {
    result = { state: "UNKNOWN", items: [] };
  }
  // Bounded memory cache: ordinary successful readings 60 seconds;
  // failures briefly cached to avoid rate-limit bursts.
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, { until: Date.now() + (result.state === "OK" ? 60_000 : 15_000), data: result });
  return result;
}
const commit = (value: unknown, repository: string): GithubCommit => {
  const row = object(value), commitInfo = object(row.commit);
  const author = object(commitInfo.author);
  return {
    sha: text(row.sha).slice(0, 40),
    title: text(commitInfo.message).split("\n")[0].slice(0, 140),
    url: safeUrl(row.html_url, repository),
    at: date(author.date),
  };
};
const pull = (value: unknown, repository: string): GithubPull => {
  const row = object(value);
  return {
    number: integer(row.number),
    title: text(row.title).slice(0, 140),
    state: row.merged_at ? "MERGED" : row.state === "open" ? "OPEN" : "CLOSED",
    url: safeUrl(row.html_url, repository),
    at: date(row.updated_at),
  };
};
const run = (value: unknown, repository: string): GithubRun => {
  const row = object(value);
  return {
    id: integer(row.id),
    title: text(row.name || row.display_title).slice(0, 140),
    status: text(row.status).slice(0, 50),
    conclusion: row.conclusion == null ? null : text(row.conclusion).slice(0, 50),
    url: safeUrl(row.html_url, repository),
    at: date(row.updated_at),
  };
};
export async function getGithubOverview(actor: Actor | null, appId: string, admin = false) {
  // Do not fetch or expose private GitHub data until application authorization.
  const assets = await getAssets(actor, appId, admin);
  const activeComponents = new Map(assets.components.filter(x => !x.archivedAt).map(x => [x.id, x.name]));
  const activeEnvironments = new Map(assets.environments.filter(x => !x.archivedAt).map(x => [x.id, x.name]));
  const activeBindings = new Map(assets.bindings.filter(x => !x.archivedAt).map(x => [x.id, x]));
  const possible = assets.references.filter(x =>
    x.provider === "GITHUB" && !x.archivedAt &&
    activeComponents.has(x.componentId) && repoPattern.test(x.repositoryFullName) &&
    ![".", ".."].includes(x.repositoryFullName.split("/")[1]) &&
    (x.resourceKind === "REPOSITORY" || (x.resourceKind === "WORKFLOW" && workflowPattern.test(x.workflowId ?? ""))) &&
    (!x.bindingId || (activeBindings.has(x.bindingId) &&
      activeEnvironments.has(activeBindings.get(x.bindingId)!.environmentId)))
  );
  // No arbitrary number of external requests from one click.
  const seen = new Set<string>();
  const selected = possible.filter(item => {
    if (!seen.has(item.repositoryFullName) && seen.size >= MAX_REPOS) return false;
    seen.add(item.repositoryFullName);
    return true;
  }).slice(0, MAX_REFS);
  const observedAt = new Date().toISOString();
  // A single repository's commits/PRs are reused for all component references.
  const repositoryReads = new Map<string, Promise<{ commits: Section<GithubCommit>; pulls: Section<GithubPull> }>>();
  for (const item of selected) {
    if (!repositoryReads.has(item.repositoryFullName)) {
      const name = item.repositoryFullName;
      const route = "repos/" + name;
      repositoryReads.set(name, Promise.all([
        readSection(name, route + "/commits?per_page=3", "commits", value => commit(value, name)),
        readSection(name, route + "/pulls?state=all&sort=updated&direction=desc&per_page=3", "pulls", value => pull(value, name)),
      ]).then(([commits, pulls]) => ({ commits, pulls })));
    }
  }
  const references = await Promise.all(selected.map(async item => {
    const name = item.repositoryFullName;
    const route = "repos/" + name;
    const runsPath = item.resourceKind === "WORKFLOW"
      ? route + "/actions/workflows/" + item.workflowId + "/runs?per_page=3"
      : route + "/actions/runs?per_page=3";
    const [repositoryData, runs] = await Promise.all([
      repositoryReads.get(name)!,
      readSection(name, runsPath, "runs", value => run(value, name)),
    ]);
    return {
      id: item.id, componentName: activeComponents.get(item.componentId)!,
      environmentName: item.bindingId
        ? activeEnvironments.get(activeBindings.get(item.bindingId)!.environmentId) ?? null : null,
      repository: name, kind: item.resourceKind,
      workflowId: item.workflowId,
      source: "GitHub REST API" as const, observedAt,
      ...repositoryData, runs,
    } satisfies GithubReference;
  }));
  return {
    source: "GitHub REST API" as const,
    fetchedAt: observedAt,
    references,
    truncated: possible.length > selected.length,
    // Explicitly separate CI data from not-yet-integrated deployment/health.
    deploymentStatus: "NOT_CONNECTED" as const,
    healthStatus: "NOT_CONNECTED" as const,
  };
}
