import { getArgoOverview } from "./argocd-overview";
import { getGithubOverview } from "./github-overview";
import { monitoredScopes } from "./devops-scope";
import type { Actor } from "./actor";
import type { ArgoOverview } from "./argocd-model";

export type SignalState = "OK" | "NOT_CONNECTED" | "UNKNOWN";
export type ObservedMetric = {
  name:string; value:number; sampledAt:string|null; revision?:string;
  environment?:string; namespace?:string;
};
export type LogEntry = {at:string|null;line:string;environment?:string;namespace?:string};
export type AlertEntry = {
  name:string;severity:string;state:string;activeAt:string|null;summary:string;
  environment?:string;namespace?:string;
};
export type Signal<T> = {
  source:string;state:SignalState;observedAt:string;items:T[];scope:string|null;
};
export type DevopsEvidence = {
  source:"P4 read-only external evidence";
  collectedAt:string;argo:ArgoOverview;
  github:Awaited<ReturnType<typeof getGithubOverview>>;
  metrics:Signal<ObservedMetric>;logs:Signal<LogEntry>;alerts:Signal<AlertEntry>;
  scopeNote:string;
};

function configuredEndpoint(key:string):URL|null {
  const value=process.env[key]?.trim();
  if(!value)return null;
  try {
    const url=new URL(value);
    if(url.username||url.password||url.search||url.hash)return null;
    if(url.protocol==="https:")return url;
    if(url.protocol==="http:"&&[
      "localhost","127.0.0.1","[::1]",
      "monitor-kube-prometheus-stack-prometheus.monitoring.svc.cluster.local",
      "loki-gateway.monitoring.svc.cluster.local",
    ].includes(url.hostname))return url;
    return null;
  }catch{return null;}
}
async function readJson(server:URL,path:string,params:Record<string,string>):Promise<unknown>{
  const url=new URL(server);
  url.pathname=url.pathname.replace(/\/$/,"")+path;
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  const response=await fetch(url,{headers:{Accept:"application/json"},redirect:"error",
    cache:"no-store",signal:AbortSignal.timeout(6500)});
  if(!response.ok||Number(response.headers.get("content-length")||0)>131072)
    throw new Error("provider_unavailable");
  const data=await response.text();
  if(data.length>131072)throw new Error("provider_response_too_large");
  return JSON.parse(data) as unknown;
}
function obj(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function arr(value:unknown):unknown[]{return Array.isArray(value)?value:[];}
function time(value:unknown):string|null {
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return null;
  const date=new Date(n*1000);
  return Number.isNaN(date.getTime())?null:date.toISOString();
}
const metricQueries=[
  {name:"namespace_ready_pods",query:(ns:string)=>'sum(kube_pod_status_ready{namespace="'+ns+'",condition="true"})'},
  {name:"namespace_container_restarts",query:(ns:string)=>'sum(kube_pod_container_status_restarts_total{namespace="'+ns+'"})'},
];

export async function collectDevopsEvidence(actor:Actor|null,appId:string,admin=false):Promise<DevopsEvidence>{
  const [argo,github]=await Promise.all([
    getArgoOverview(actor,appId,admin),getGithubOverview(actor,appId,admin),
  ]);
  const collectedAt=new Date().toISOString();
  const prom=configuredEndpoint("PROMETHEUS_SERVER_URL");
  const loki=configuredEndpoint("LOKI_SERVER_URL");
  const scopes=monitoredScopes(argo,appId);
  const scopeNames=scopes.map(item=>item.namespace);
  const metrics:Signal<ObservedMetric>={source:"Prometheus query API",
    state:prom?"UNKNOWN":"NOT_CONNECTED",observedAt:collectedAt,items:[],
    scope:scopeNames.join(", ")||null};
  const alerts:Signal<AlertEntry>={source:"Prometheus alerts API",
    state:prom?"UNKNOWN":"NOT_CONNECTED",observedAt:collectedAt,items:[],
    scope:scopeNames.join(", ")||null};
  const logs:Signal<LogEntry>={source:"Loki query_range API",
    state:loki?"UNKNOWN":"NOT_CONNECTED",observedAt:collectedAt,items:[],
    scope:scopeNames.join(", ")||null};
  const scopeNote=!scopes.length
    ? "未确认当前应用的独立 Argo 项目/环境命名空间；禁止读取共享监控范围以免混入其他应用。"
    : "已验证 "+scopes.length+" 个环境的 Argo 归属；采集按环境 namespace 隔离，未采集到指标不代表正常。";
  if(!scopes.length)return{
    source:"P4 read-only external evidence",collectedAt,argo,github,metrics,alerts,logs,scopeNote,
  };

  await Promise.all([
    (async()=>{
      if(!prom)return;
      let succeeded=false;
      const result=await Promise.all(scopes.flatMap(scope=>{
        const queries=scope.container==="lab"
          ?[{name:"active_release",query:(ns:string)=>'marketplace_lab_info{namespace="'+ns+'"}'},
            {name:"active_lab_health",query:(ns:string)=>'min(marketplace_lab_health{namespace="'+ns+'"})'},
            ...metricQueries]:metricQueries;
        return queries.map(async item=>{
          try {
            const response=obj(await readJson(prom,"/api/v1/query",{query:item.query(scope.namespace)}));
            if(response.status!=="success")return;
            const series=arr(obj(response.data).result);
            if(item.name==="active_release"&&series.length!==1)return;
            for(const point of series.slice(0,1)){
              const entry=obj(point);
              const value=arr(entry.value);
              if(value.length!==2)continue;
              const n=Number(value[1]);
              if(!Number.isFinite(n))continue;
              const revision=String(obj(entry.metric).revision||"");
              metrics.items.push({
                name:item.name,value:n,sampledAt:time(value[0]),
                environment:scope.environment,namespace:scope.namespace,
                ...(item.name==="active_release"&&(/^[a-f0-9]{40}$/.test(revision)||revision==="local")?{revision}:{}),
              });
            }
            succeeded=true;
          }catch{ /* preserve partial evidence and mark unavailable if all fail */ }
        });
      }));
      void result;
      metrics.state=succeeded?"OK":"UNKNOWN";
    })(),
    (async()=>{
      if(!prom)return;
      try {
        const response=obj(await readJson(prom,"/api/v1/alerts",{}));
        if(response.status!=="success")throw new Error("prometheus_alerts");
        const allowed=new Map(scopes.map(scope=>[scope.namespace,scope.environment]));
        alerts.items=arr(obj(response.data).alerts).flatMap(value=>{
          const row=obj(value),labels=obj(row.labels),ns=labels.namespace;
          if(typeof ns!=="string"||!allowed.has(ns))return [];
          const annotations=obj(row.annotations);
          const active=typeof row.activeAt==="string"&&!Number.isNaN(Date.parse(row.activeAt))?row.activeAt:null;
          return [{
            name:String(labels.alertname??"unknown").slice(0,100),
            severity:String(labels.severity??"unknown").slice(0,30),
            state:String(row.state??"unknown").slice(0,20),
            activeAt:active,summary:String(annotations.summary??"").slice(0,300),
            namespace:ns,environment:allowed.get(ns),
          }];
        }).slice(0,24);
        alerts.state="OK";
      }catch{alerts.state="UNKNOWN";}
    })(),
    (async()=>{
      if(!loki)return;
      let successes=0;
      await Promise.all(scopes.map(async scope=>{
        try {
          const now=Date.now();
          const response=obj(await readJson(loki,"/loki/api/v1/query_range",{
            query:'{namespace="'+scope.namespace+'",container="'+scope.container+'"}',
            start:String((now-15*60*1000)*1000000),end:String(now*1000000),
            limit:"20",direction:"BACKWARD",
          }));
          if(response.status!=="success")return;
          successes++;
          for(const stream of arr(obj(response.data).result)){
            for(const sample of arr(obj(stream).values)){
              const pair=arr(sample);
              if(pair.length!==2||typeof pair[1]!=="string")continue;
              const ns=Number(pair[0]);
              logs.items.push({
                at:Number.isFinite(ns)&&ns>0?new Date(Math.floor(ns/1000000)).toISOString():null,
                line:pair[1].slice(0,350),
                namespace:scope.namespace,environment:scope.environment,
              });
              if(logs.items.length>=40)break;
            }
            if(logs.items.length>=40)break;
          }
        }catch{ /* inaccessible scope doesn't authorize a broader fallback */ }
      }));
      logs.items.sort((a,b)=>(b.at??"").localeCompare(a.at??""));
      logs.state=successes===scopes.length?"OK":"UNKNOWN";
    })(),
  ]);
  return {
    source:"P4 read-only external evidence",collectedAt,argo,github,metrics,alerts,logs,
    scopeNote:scopeNote+" 云端诊断默认不上传原始日志。",
  };
}
