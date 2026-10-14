import { assetWrite } from "@/domain/asset-route";
import { recordManualProvision } from "@/domain/access-request-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return assetWrite(request, async (actor, body) => recordManualProvision(actor, (await context.params).id, body));
}
