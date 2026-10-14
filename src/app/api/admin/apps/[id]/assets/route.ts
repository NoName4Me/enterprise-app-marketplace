import { route } from "@/domain/route";
import { getAssets } from "@/domain/asset-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return route(request, async actor => getAssets(actor, (await context.params).id, true));
}
