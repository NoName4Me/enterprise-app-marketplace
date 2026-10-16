import { route } from "@/domain/route";
import { assetWrite } from "@/domain/asset-route";
import { getDelivery, startDelivery, reviewDelivery, verifyDeliveryPr, startDeliveryTestRelease } from "@/domain/temporal-delivery";
import { AppError } from "@/domain/app-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{id:string}> };
export function GET(req: Request,c:Context) {
  return route(req,async actor => getDelivery(actor,(await c.params).id));
}
export function POST(req: Request,c:Context) {
  return assetWrite(req,async (actor,body) => {
    if(Object.keys(body).length) throw new AppError(422,"unknown_field");
    return startDelivery(actor,(await c.params).id);
  },201);
}
export function PATCH(req:Request,c:Context) {
  return assetWrite(req,async (actor,body) => {
    if(body.decision==="START_TEST_RELEASE"&&Object.keys(body).length===1)
      return startDeliveryTestRelease(actor,(await c.params).id);
    if(body.decision==="VERIFY_PR"&&Object.keys(body).every(k=>["decision","prNumber"].includes(k)))
      return verifyDeliveryPr(actor,(await c.params).id,Number(body.prNumber));
    if(Object.keys(body).some(k=>k!=="decision") ||
      (body.decision!=="APPROVE"&&body.decision!=="REJECT"))
      throw new AppError(422,"invalid_decision");
    return reviewDelivery(actor,(await c.params).id,body.decision);
  });
}
