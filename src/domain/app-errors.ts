export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function httpErrorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({ error: error.code, message: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  // Unknown errors must not leak SQL, stack traces or private fields to clients.
  // Avoid logging SQL bound parameters (which can contain employee data).
  console.error("Unhandled application operation error", {
    category: error instanceof Error ? error.name : "unknown",
  });
  return Response.json({ error: "internal_error" },
    { status: 500, headers: { "Cache-Control": "no-store" } });
}

export async function readObjectJson(request: Request, allowEmpty = false): Promise<Record<string, unknown>> {
  // Limit JSON input before parsing to avoid unbounded request allocations.
  const size = request.headers.get("content-length");
  if (size && Number(size) > 16384) throw new AppError(400, "payload_too_large");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  if (reader) try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 16384) { await reader.cancel(); throw new AppError(400, "payload_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!length && allowEmpty) return {};
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const text = new TextDecoder().decode(bytes);
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new AppError(400, "invalid_json"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(422, "invalid_body");
  }
  return parsed as Record<string, unknown>;
}
