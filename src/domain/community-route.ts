import { route } from "./route";
import { readObjectJson } from "./app-errors";
import { assertWriteOrigin } from "./write-origin";
import type { Actor } from "./actor";

export function communityWrite(request: Request, execute: (actor: Actor | null, body: Record<string, unknown>) => Promise<unknown>) {
  return route(request, async actor => {
    // Cookie-authenticated browser writes must originate from this application.
    assertWriteOrigin(request);
    return execute(actor, await readObjectJson(request));
  });
}
