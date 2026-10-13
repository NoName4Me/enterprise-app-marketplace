import { getActiveUser } from "@/lib/active-user";
import { httpErrorResponse } from "./app-errors";
import type { Actor } from "./actor";

export const noStore = { "Cache-Control": "private, no-store" };

export async function route(
  request: Request,
  execute: (actor: Actor | null) => Promise<unknown>,
  status = 200,
) {
  try {
    const user = await getActiveUser(request.headers);
    const payload = await execute(user ? { id: user.id } : null);
    return Response.json(payload, { status, headers: noStore });
  } catch (error) {
    return httpErrorResponse(error);
  }
}
