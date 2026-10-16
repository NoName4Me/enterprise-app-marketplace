import {route} from "@/domain/route";
import {AppError} from "@/domain/app-errors";
import {readHostedRuntime} from "@/domain/hosted-runtime";
import type {HostedEnvironment} from "@/domain/hosted-runtime-model";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export function GET(request:Request,ctx:Context){
  return route(request,async actor=>{
    const environment=new URL(request.url).searchParams.get("environment")??"PRODUCTION";
    if(environment!=="PRODUCTION"&&environment!=="TEST")
      throw new AppError(422,"invalid_environment");
    return readHostedRuntime(actor,(await ctx.params).id,environment as HostedEnvironment);
  });
}
