import { route } from "@/domain/route";
import { lifecyclePreflight } from "@/domain/lifecycle-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return route(request, async actor => lifecyclePreflight(actor, (await context.params).id, false));
}
