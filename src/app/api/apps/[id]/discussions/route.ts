import { communityWrite } from "@/domain/community-route";
import { addDiscussion } from "@/domain/community-service";
export const runtime = "nodejs";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return communityWrite(request, async (actor, body) => addDiscussion(actor, (await context.params).id, body));
}
