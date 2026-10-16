import {readFileSync} from "node:fs";
import {request as httpsRequest} from "node:https";
import {and,desc,eq} from "drizzle-orm";
import {db} from "@/db/client";
import {applications,appEnvironments,appHostedPorts,hostedReleases} from "@/db/schema";
import {authorizeActor,type Actor} from "./actor";
import {AppError} from "./app-errors";
import {observeHostedWorkload,type HostedEnvironment,type HostedRuntimeState} from "./hosted-runtime-model";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const obj=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
type K8sResponse={status:number;resource:Record<string,unknown>};

async function kubernetesGet(path:string):Promise<K8sResponse>{
  const host=process.env.KUBERNETES_SERVICE_HOST?.trim();
  const port=Number(process.env.KUBERNETES_SERVICE_PORT_HTTPS??"443");
  if(!host||!/^[a-zA-Z0-9.:-]+$/.test(host)||!Number.isInteger(port)||port<1||port>65535)
    throw new Error("kubernetes_not_configured");
  const key=readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/token","utf8").trim();
  const ca=readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt");
  return await new Promise<K8sResponse>((resolve,reject)=>{
    const req=httpsRequest({hostname:host,port,path,method:"GET",ca,rejectUnauthorized:true,
      timeout:7500,headers:{Authorization:"Bearer "+key,Accept:"application/json"}},res=>{
      const chunks:Buffer[]=[];let size=0;
      res.on("data",(chunk:Buffer)=>{size+=chunk.length;
        if(size>128*1024)res.destroy(new Error("kubernetes_response_too_large"));
        else chunks.push(chunk);
      });
      res.on("error",reject);
      res.on("end",()=>{
        try{const payload=Buffer.concat(chunks).toString("utf8");
          resolve({status:res.statusCode??0,resource:obj(payload?JSON.parse(payload):{})});
        }catch(e){reject(e);}
      });
    });
    req.on("timeout",()=>req.destroy(new Error("kubernetes_timeout")));
    req.on("error",reject);req.end();
  });
}
function privateAddress(){
  const raw=process.env.HOSTED_PUBLIC_IP?.trim()??"";
  const parts=raw.split(".");
  if(parts.length!==4||parts.some(s=>!/^\d{1,3}$/.test(s)))return null;
  const octets=parts.map(Number);
  if(octets.some(x=>x>255)||!(octets[0]===10||
    (octets[0]===172&&octets[1]>=16&&octets[1]<=31)||
    (octets[0]===192&&octets[1]===168)))return null;
  return raw;
}
async function probeHttp(port:number):Promise<boolean|null>{
  const ip=privateAddress();
  if(!ip||!Number.isInteger(port)||port<31000||port>31999)return null;
  try{const response=await fetch("http://"+ip+":"+port+"/",{
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(4500)
  });await response.body?.cancel();return response.ok;}catch{return false;}
}
export async function readHostedRuntime(actor:Actor|null,appId:string,environment:HostedEnvironment){
  const user=await authorizeActor(actor,"active");
  if(!UUID.test(appId))throw new AppError(404,"not_found");
  if(environment!=="PRODUCTION"&&environment!=="TEST")throw new AppError(422,"invalid_environment");
  const [app]=await db.select({owner:applications.ownerUserId,kind:applications.sourceKind})
    .from(applications).where(eq(applications.id,appId)).limit(1);
  if(!app||app.owner!==user.id)throw new AppError(404,"not_found");
  if(app.kind!=="HOSTED")throw new AppError(422,"external_app_not_hosted");
  const [[registered],[port],releaseHistory] = await Promise.all([
    db.select({id:appEnvironments.id}).from(appEnvironments).where(and(
      eq(appEnvironments.appId,appId),eq(appEnvironments.purpose,environment))).limit(1),
    db.select({nodePort:appHostedPorts.nodePort,state:appHostedPorts.state,
      imageDigest:appHostedPorts.imageDigest,verifiedAt:appHostedPorts.verifiedAt})
      .from(appHostedPorts).where(and(eq(appHostedPorts.appId,appId),
        eq(appHostedPorts.environment,environment))).limit(1),
    db.select({id:hostedReleases.id,status:hostedReleases.status,
      versionLabel:hostedReleases.versionLabel,releaseNotes:hostedReleases.releaseNotes,
      sourceSha:hostedReleases.sourceSha,imageDigest:hostedReleases.imageDigest,
      createdAt:hostedReleases.createdAt,note:hostedReleases.note})
      .from(hostedReleases).where(and(eq(hostedReleases.appId,appId),
        eq(hostedReleases.environment,environment)))
      .orderBy(desc(hostedReleases.createdAt)).limit(30)
  ]);
  const latest=releaseHistory[0];
  // The most recent attempt can fail while the previous tested image is still live.
  // Show the version associated with the verified running digest instead of the failed attempt.
  const active=releaseHistory.find(item=>item.status==="READY"&&
    !!port?.imageDigest&&item.imageDigest===port.imageDigest);
  const observedAt=new Date().toISOString();
  const ns="hosted-"+appId.replaceAll("-","")+"-"+environment.toLowerCase();
  const base={environment,namespace:ns,observedAt,port:port?.nodePort??null,
    verifiedDigest:port?.imageDigest??null,
    verifiedAt:port?.verifiedAt??null,
    release:active??latest??null,latestAttempt:latest?.status??null,
    accessUrl:null as string|null};
  if(!registered||!port)return {...base,state:"NOT_DEPLOYED" as HostedRuntimeState,
    reason:"该应用尚未初始化此环境",workload:null,httpReachable:null};
  if(!latest&&port.state==="RESERVED")return {...base,state:"NOT_DEPLOYED" as HostedRuntimeState,
    reason:environment==="PRODUCTION"?"尚未发布生产版本，可从发布页选择已验证的 TEST 版本":"尚未发布 TEST 版本",
    workload:null,httpReachable:null};
  try{
    // The Portal SA can GET only namespaces, deployments and services, never secrets.
    // Authorize the owning app BEFORE deriving and accessing its namespace.
    const namespace=await kubernetesGet("/api/v1/namespaces/"+ns);
    if(namespace.status===404)return {...base,state:"NOT_DEPLOYED" as HostedRuntimeState,
      reason:"Kubernetes 中尚无该环境命名空间",workload:null,httpReachable:null};
    if(namespace.status!==200)throw new Error("kubernetes_namespace_unavailable");
    const labels=obj(obj(namespace.resource.metadata).labels);
    if(labels["marketplace-app-id"]!==appId||
      labels["marketplace-environment-id"]!==registered.id)
      throw new Error("kubernetes_namespace_identity_mismatch");
    const [deployment,service]=await Promise.all([
      kubernetesGet("/apis/apps/v1/namespaces/"+ns+"/deployments/web"),
      kubernetesGet("/api/v1/namespaces/"+ns+"/services/web")
    ]);
    if(deployment.status===404&&service.status===404)
      return {...base,state:"NOT_DEPLOYED" as HostedRuntimeState,
        reason:"Kubernetes 中还没有部署这个环境",workload:null,httpReachable:null};
    if(deployment.status!==200||service.status!==200)
      return {...base,state:"DEGRADED" as HostedRuntimeState,
        reason:"Deployment 或 Service 缺失/不可读",workload:null,httpReachable:null};
    const workload=observeHostedWorkload(deployment.resource,service.resource,{
      namespace:ns,nodePort:port.nodePort,digest:port.imageDigest
    });
    const httpReachable=workload.ready?await probeHttp(port.nodePort):null;
    const ready=workload.ready&&httpReachable===true&&port.state==="READY";
    const progress=latest&&["REQUESTING","BUILDING","DEPLOYING"].includes(latest.status);
    const state:HostedRuntimeState=ready?"READY":progress?"DEPLOYING":"DEGRADED";
    const reason=ready?"Kubernetes 镜像、Pod/Service 和 HTTP 均已验证":
      progress?"新版本发布进行中；以下显示当前实际容器状态":
      !workload.ready?workload.reason:
      httpReachable===null?"服务访问探测未配置":httpReachable===false?"HTTP 访问检查未通过":"发布记录尚未确认 READY";
    const ip=privateAddress();
    return {...base,state,reason,workload,httpReachable,
      accessUrl:ready&&ip?"http://"+ip+":"+port.nodePort+"/":null};
  }catch{
    return {...base,state:"UNKNOWN" as HostedRuntimeState,
      reason:"暂时无法读取真实 Kubernetes 资源；请检查门户 ServiceAccount 的运行状态读取权限",
      workload:null,httpReachable:null};
  }
}
