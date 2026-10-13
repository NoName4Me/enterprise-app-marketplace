import { AppError } from "./app-errors";

export type AppContent = {
  name: string;
  summary: string;
  description: string;
  category: string;
  targetUrl: string;
  iconRef: string | null;
};

const fields = ["name", "summary", "description", "category", "targetUrl", "iconRef"] as const;
const categories = new Set(["office", "analytics", "development", "collaboration", "other"]);
export const emptyContent: AppContent = {
  name: "", summary: "", description: "", category: "other", targetUrl: "", iconRef: null,
};

function safeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password
      && !url.hash && !/[\u0000-\u001f]/u.test(value);
  } catch { return false; }
}

export function validateContent(
  payload: Record<string, unknown>,
  previous: AppContent = emptyContent,
  requireComplete = false,
): AppContent {
  if (Object.keys(payload).some((key) => !fields.includes(key as typeof fields[number]))) {
    throw new AppError(422, "unknown_field");
  }
  const updated: AppContent = { ...previous };
  for (const field of fields) {
    if (!Object.hasOwn(payload, field)) continue;
    const value = payload[field];
    if (field === "iconRef") {
      if (value !== null && (typeof value !== "string" || value.length > 2048 ||
          (value.length > 0 && !safeHttpsUrl(value)))) {
        throw new AppError(422, "invalid_icon_url");
      }
      updated.iconRef = value === "" ? null : value as string | null;
    } else {
      if (typeof value !== "string") throw new AppError(422, "invalid_" + field);
      updated[field] = value.trim();
    }
  }
  if (updated.name.length > 120 || updated.summary.length > 300 || updated.description.length > 5000) {
    throw new AppError(422, "text_too_long");
  }
  if (updated.targetUrl.length > 2048 || (updated.targetUrl && !safeHttpsUrl(updated.targetUrl))) {
    throw new AppError(422, "invalid_target_url");
  }
  if (!categories.has(updated.category)) throw new AppError(422, "invalid_category");
  if (requireComplete && (!updated.name || !updated.summary || !updated.targetUrl)) {
    throw new AppError(422, "missing_required_fields");
  }
  return updated;
}
