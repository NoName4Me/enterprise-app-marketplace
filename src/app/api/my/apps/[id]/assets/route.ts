import { route } from "@/domain/route";
import { assetWrite } from "@/domain/asset-route";
import { getAssets, updateAssetTeam } from "@/domain/asset-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return route(request, async actor => getAssets(actor, (await context.params).id));
}
export function PATCH(request: Request, context: Context) {
  return assetWrite(request, async (actor, body) => updateAssetTeam(actor, (await context.params).id, body));
}
