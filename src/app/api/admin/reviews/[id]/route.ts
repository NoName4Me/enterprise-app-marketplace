import { route } from "@/domain/route";
import { getPendingReview } from "@/domain/app-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return route(request, async (actor) =>
    getPendingReview(actor, (await context.params).id));
}
