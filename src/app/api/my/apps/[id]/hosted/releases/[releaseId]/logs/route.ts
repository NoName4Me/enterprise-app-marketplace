import {route} from "@/domain/route";
import {readHostedJobLog} from "@/domain/hosted-release-execution";
import {AppError} from "@/domain/app-errors";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string;releaseId:string}>};
export function GET(req:Request,ctx:Context){
  return route(req,async actor=>{
    const {id,releaseId}=await ctx.params;
    const url=new URL(req.url);
    const jobId=url.searchParams.get("jobId");
    if(!jobId||!/^[1-9][0-9]{0,18}$/.test(jobId))throw new AppError(422,"invalid_job_id");
    return readHostedJobLog(actor,id,releaseId,jobId);
  });
}
