import {route} from "@/domain/route";
import {getHostedExecution} from "@/domain/hosted-release-execution";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string;releaseId:string}>};
export function GET(req:Request,ctx:Context){
  return route(req,async actor=>{
    const {id,releaseId}=await ctx.params;
    return getHostedExecution(actor,id,releaseId);
  });
}
