import { communityWrite } from "@/domain/community-route";
import { setFavorite } from "@/domain/community-service";
export const runtime = "nodejs";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return communityWrite(request, async (actor, body) => setFavorite(actor, (await context.params).id, body.saved));
}
