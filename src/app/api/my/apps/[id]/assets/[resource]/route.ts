import { assetWrite } from "@/domain/asset-route";
import { createAsset } from "@/domain/asset-service";
import { assetResource } from "@/domain/asset-validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; resource: string }> };
export function POST(request: Request, context: Context) {
  return assetWrite(request, async (actor, body) => {
    const { id, resource } = await context.params;
    return createAsset(actor, id, assetResource(resource), body);
  }, 201);
}
