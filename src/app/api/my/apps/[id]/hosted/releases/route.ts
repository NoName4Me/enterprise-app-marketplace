import {route} from "@/domain/route";
import {assetWrite} from "@/domain/asset-route";
import {AppError} from "@/domain/app-errors";
import {listHostedReleases,startHostedRelease} from "@/domain/hosted-release-service";
export const runtime="nodejs";export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export function GET(req:Request,ctx:Context){
  return route(req,actor=>ctx.params.then(({id})=>listHostedReleases(actor,id)));
}
export function POST(req:Request,ctx:Context){
  return assetWrite(req,async(actor,data)=>{
    if(Object.keys(data).some(key=>key!=="environment"&&key!=="testedReleaseId"))
      throw new AppError(422,"unknown_field");
    return startHostedRelease(actor,(await ctx.params).id,data.environment,data.testedReleaseId??null);
  },201);
}
