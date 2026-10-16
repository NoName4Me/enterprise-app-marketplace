import {route} from "@/domain/route";
import {inspectHostedRelease} from "@/domain/hosted-release-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string;releaseId:string}>};
export function GET(req:Request,ctx:Context){
  return route(req,async actor=>{
    const p=await ctx.params;
    return inspectHostedRelease(actor,p.id,p.releaseId);
  });
}
