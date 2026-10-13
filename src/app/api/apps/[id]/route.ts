import { route } from "@/domain/route";
import { getPublished } from "@/domain/app-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return route(request, async (actor) => getPublished(actor, (await context.params).id));
}
