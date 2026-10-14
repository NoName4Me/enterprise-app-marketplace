import { assetWrite } from "@/domain/asset-route";
import { transitionLifecycle } from "@/domain/lifecycle-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function POST(request: Request, context: Context) {
  return assetWrite(request, async (actor, body) => transitionLifecycle(actor, (await context.params).id, body, true));
}
