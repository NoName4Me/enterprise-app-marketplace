import {route} from "@/domain/route";
import {getReadyPodHistory} from "@/domain/ops-series";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export function GET(request:Request,context:Context){
  return route(request,async actor=>getReadyPodHistory(actor,(await context.params).id));
}
