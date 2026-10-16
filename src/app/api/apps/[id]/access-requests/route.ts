import { route } from "@/domain/route";
import { assetWrite } from "@/domain/asset-route";
import { myAppAccessRequest, requestAppAccess } from "@/domain/access-request-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return route(request, async actor => myAppAccessRequest(actor, (await context.params).id));
}
export function POST(request: Request, context: Context) {
  return assetWrite(request, async (actor, body) => requestAppAccess(actor, (await context.params).id, body), 201);
}
