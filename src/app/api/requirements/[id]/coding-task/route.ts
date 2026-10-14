import { route } from "@/domain/route";
import { assetWrite } from "@/domain/asset-route";
import { getCodingTask, startCodingTask } from "@/domain/coding-agent-service";
export const runtime="nodejs"; export const dynamic="force-dynamic";
type C={params:Promise<{id:string}>};
export function GET(req:Request,c:C){return route(req,async a=>getCodingTask(a,(await c.params).id));}
export function POST(req:Request,c:C){return assetWrite(req,async(a,b)=>{if(Object.keys(b).length)throw new Error("invalid_body");return startCodingTask(a,(await c.params).id);});}
