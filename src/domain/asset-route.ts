import { route } from "./route";
import { readObjectJson } from "./app-errors";
import { assertWriteOrigin } from "./write-origin";
import type { Actor } from "./actor";

export function assetWrite(request: Request, execute: (actor: Actor | null, body: Record<string, unknown>) => Promise<unknown>, status = 200) {
  return route(request, async actor => {
    assertWriteOrigin(request);
    return execute(actor, await readObjectJson(request));
  }, status);
}
