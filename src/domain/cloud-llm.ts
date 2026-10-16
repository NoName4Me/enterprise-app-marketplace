/** OpenAI-compatible hosted LLM; never used as a privileged executor. */
export type CloudModelConfig = { endpoint: URL; apiKey: string; model: string; provider: string };

export function cloudModelConfig(): CloudModelConfig | null {
  const apiKey = process.env.AIOPS_LLM_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
  const model = process.env.AIOPS_LLM_MODEL?.trim() || "deepseek-flash";
  const rawBase = process.env.AIOPS_LLM_BASE_URL?.trim() || "https://api.deepseek.com";
  if (!apiKey || !model || model.length > 100 || /[\r\n]/.test(model)) return null;
  try {
    const url = new URL(rawBase);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        !url.hostname || url.port) return null;
    // The base URL is trusted configuration; never accept it from user input or evidence.
    url.pathname = url.pathname.replace(/\/$/, "") + "/chat/completions";
    return { endpoint: url, apiKey, model, provider: url.hostname };
  } catch { return null; }
}

export async function hostedCompletion(messages: { role: "system" | "user"; content: string }[],
  maxTokens = 900): Promise<{ text: string; model: string; provider: string }> {
  const config = cloudModelConfig();
  if (!config) throw new Error("model_not_configured");
  const response = await fetch(config.endpoint, {
    method: "POST", redirect: "error", cache: "no-store",
    headers: { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ model: config.model, messages, stream: false, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 131072) throw new Error("model_unavailable");
  const raw = await response.text();
  if (raw.length > 131072) throw new Error("model_response_large");
  const json: unknown = JSON.parse(raw);
  const answer = json && typeof json === "object" && "choices" in json ?
    (json as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content : undefined;
  if (typeof answer !== "string" || !answer.trim()) throw new Error("empty_response");
  return { text: answer.trim().slice(0, 6000), model: config.model, provider: config.provider };
}

/** Minimal defense in depth against tokens/passwords in CI metadata. */
export function redactText(value: string): string {
  return value
    .replace(/\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\b(?:password|token|secret|api[_-]?key|authorization)\s*[:=]\s*['"]?[^\s,'"]+/gi, "[REDACTED_FIELD]");
}
