import { route } from "./route";
import { readObjectJson, AppError } from "./app-errors";
import type { Actor } from "./actor";

export function assetWrite(request: Request, execute: (actor: Actor | null, body: Record<string, unknown>) => Promise<unknown>, status = 200) {
  return route(request, async actor => {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new AppError(403, "forbidden");
    return execute(actor, await readObjectJson(request));
  }, status);
}
