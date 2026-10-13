import { communityWrite } from "@/domain/community-route";
import { manageListing } from "@/domain/community-service";
export const runtime = "nodejs";
export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return communityWrite(request, async (actor, body) => manageListing(actor, (await context.params).id, body));
}
