import type {Actor} from "./actor";
import {getArgoOverview} from "./argocd-overview";
import {monitoredScopes} from "./devops-scope";

export type ReadyPodPoint={at:string;value:number};
export type ReadyPodHistory={
  collectedAt:string;
  source:"Prometheus query_range API";
  series:{environment:string;namespace:string;state:"OK"|"UNKNOWN"|"NOT_CONNECTED";points:ReadyPodPoint[]}[];
};
function endpoint():URL|null{
  const raw=process.env.PROMETHEUS_SERVER_URL?.trim();
  if(!raw)return null;
  try {
    const url=new URL(raw);
    if(url.username||url.password||url.search||url.hash)return null;
    if(url.protocol==="https:")return url;
    if(url.protocol==="http:"&&["localhost","127.0.0.1","[::1]",
      "monitor-kube-prometheus-stack-prometheus.monitoring.svc.cluster.local"].includes(url.hostname))return url;
    return null;
  }catch{return null;}
}
function obj(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
export function parseReadyHistory(payload:unknown,from:number,to:number):ReadyPodPoint[]{
  const response=obj(payload);
  if(response.status!=="success")return [];
  const data=obj(response.data);
  if(data.resultType!=="matrix"||!Array.isArray(data.result)||data.result.length!==1)return [];
  const row=obj(data.result[0]);
  if(!Array.isArray(row.values))return [];
  const result:ReadyPodPoint[]=[];
  for(const raw of row.values.slice(-25)){
    if(!Array.isArray(raw)||raw.length!==2)continue;
    const sec=Number(raw[0]),value=Number(raw[1]);
    if(!Number.isFinite(sec)||sec<from||sec>to||!Number.isFinite(value)||value<0||value>10000)continue;
    result.push({at:new Date(sec*1000).toISOString(),value});
  }
  return result.sort((a,b)=>a.at.localeCompare(b.at));
}
export async function getReadyPodHistory(actor:Actor|null,appId:string):Promise<ReadyPodHistory>{
  // The owner authorization and Argo project/labels check run BEFORE any monitoring query.
  const argo=await getArgoOverview(actor,appId);
  const scopes=monitoredScopes(argo,appId);
  const server=endpoint(),end=Math.floor(Date.now()/1000),start=end-3600;
  const series=await Promise.all(scopes.map(async scope=>{
    const base={environment:scope.environment,namespace:scope.namespace,points:[] as ReadyPodPoint[]};
    if(!server)return {...base,state:"NOT_CONNECTED" as const};
    try{
      const url=new URL(server);
      url.pathname=url.pathname.replace(/\/$/,"")+"/api/v1/query_range";
      url.searchParams.set("query",'sum(kube_pod_status_ready{namespace="'+scope.namespace+'",condition="true"})');
      url.searchParams.set("start",String(start));
      url.searchParams.set("end",String(end));
      url.searchParams.set("step","300");
      const response=await fetch(url,{
        method:"GET",headers:{Accept:"application/json"},cache:"no-store",
        redirect:"error",signal:AbortSignal.timeout(6500),
      });
      if(!response.ok||Number(response.headers.get("content-length")||0)>64000)
        return {...base,state:"UNKNOWN" as const};
      const text=await response.text();
      if(text.length>64000)return {...base,state:"UNKNOWN" as const};
      const points=parseReadyHistory(JSON.parse(text) as unknown,start,end);
      return {...base,points,state:points.length?"OK" as const:"UNKNOWN" as const};
    }catch{return {...base,state:"UNKNOWN" as const};}
  }));
  return{source:"Prometheus query_range API",collectedAt:new Date().toISOString(),series};
}
