import { route } from "@/domain/route";
import { communityWrite } from "@/domain/community-route";
import { getCommunity, manageCommunity } from "@/domain/community-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return route(request, async actor => getCommunity(actor, (await context.params).id));
}
export function PATCH(request: Request, context: Context) {
  return communityWrite(request, async (actor, body) => manageCommunity(actor, (await context.params).id, body));
}
