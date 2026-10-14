import { assetWrite } from "@/domain/asset-route";
import { transferOwner } from "@/domain/lifecycle-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return assetWrite(request, async (actor, body) => transferOwner(actor, (await context.params).id, body));
}
