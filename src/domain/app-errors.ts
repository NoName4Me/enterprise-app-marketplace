export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
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
  console.error("Unhandled application operation error:", error);
  return Response.json({ error: "internal_error" },
    { status: 500, headers: { "Cache-Control": "no-store" } });
}

export async function readObjectJson(request: Request): Promise<Record<string, unknown>> {
  // Limit JSON input before parsing to avoid unbounded request allocations.
  const size = request.headers.get("content-length");
  if (size && Number(size) > 16384) throw new AppError(400, "payload_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 16384) throw new AppError(400, "payload_too_large");
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new AppError(400, "invalid_json"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(422, "invalid_body");
  }
  return parsed as Record<string, unknown>;
}
