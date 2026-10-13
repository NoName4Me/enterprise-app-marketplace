import { route } from "./route";
import { readObjectJson, AppError } from "./app-errors";
import type { Actor } from "./actor";

export function communityWrite(request: Request, execute: (actor: Actor | null, body: Record<string, unknown>) => Promise<unknown>) {
  return route(request, async actor => {
    // Cookie-authenticated browser writes must originate from this application.
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new AppError(403, "forbidden");
    return execute(actor, await readObjectJson(request));
  });
}
