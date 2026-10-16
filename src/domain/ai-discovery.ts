import { cloudModelConfig, hostedCompletion } from "./cloud-llm";
import { matchScenarios } from "./discovery";
type App = { id: string; name: string; summary: string; description: string; category: string };
export async function discoverPublishedApps<T extends App>(query: string, apps: T[]) {
  const baseline = matchScenarios(query, apps);
  if (!cloudModelConfig() || !query.trim() || !apps.length) return { matches: baseline, mode: "KEYWORDS" as const };
  // Model can only rank supplied, approved catalogue ids. No vector store or private asset access.
  const limited = apps.slice(0, 100);
  const catalog = limited.map(app => ({ id: app.id, name: app.name,
    summary: app.summary.slice(0, 140), category: app.category }));
  try {
    const result = await hostedCompletion([
      { role: "system", content: "你是企业应用目录的只读匹配助手。只能从提供的已上架应用 id 选择最多 6 个候选，不能虚构应用、访问权限或功能。可无匹配。仅返回JSON对象，字段 ids 是字符串数组。" },
      { role: "user", content: JSON.stringify({ query: query.slice(0, 120), applications: catalog }).slice(0, 16000) },
    ], 350);
    const raw = result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1);
    const parsed: unknown = JSON.parse(raw);
    const ids = parsed && typeof parsed === "object" && "ids" in parsed ? (parsed as { ids: unknown }).ids : [];
    if (!Array.isArray(ids) || ids.some(x => typeof x !== "string")) throw new Error("invalid_ranking");
    const allowed = new Map(limited.map(app => [app.id, app]));
    const matches = [...new Set(ids)].slice(0, 6).flatMap(value => {
      const app = allowed.get(value);
      return app ? [{ app, reason: "匹配依据：该应用已审核上架，简介——" + app.summary.slice(0, 140) }] : [];
    });
    return { matches, mode: "MODEL" as const };
  } catch {
    return { matches: baseline, mode: "FALLBACK" as const };
  }
}
