import { communityWrite } from "@/domain/community-route";
import { saveFeedback } from "@/domain/community-service";
export const runtime = "nodejs";
export function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return communityWrite(request, async (actor, body) => saveFeedback(actor, (await context.params).id, body));
}
