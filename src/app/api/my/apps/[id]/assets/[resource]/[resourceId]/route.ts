import { assetWrite } from "@/domain/asset-route";
import { updateAsset } from "@/domain/asset-service";
import { assetResource } from "@/domain/asset-validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; resource: string; resourceId: string }> };
export function PATCH(request: Request, context: Context) {
  return assetWrite(request, async (actor, body) => {
    const { id, resource, resourceId } = await context.params;
    return updateAsset(actor, id, assetResource(resource), resourceId, body);
  });
}
