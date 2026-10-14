import { assetWrite } from "@/domain/asset-route";
import { decideAppAccess } from "@/domain/access-request-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return assetWrite(request, async (actor, body) => decideAppAccess(actor, (await context.params).id, body));
}
