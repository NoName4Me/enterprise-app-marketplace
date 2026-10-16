"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import type {HostedEnvironment,HostedRuntimeState,WorkloadObservation} from "@/domain/hosted-runtime-model";

type Runtime={
  environment:HostedEnvironment;namespace:string;observedAt:string;
  state:HostedRuntimeState;reason:string;port:number|null;
  verifiedDigest:string|null;verifiedAt:string|null;
  release:{id:string;status:string;versionLabel:string|null;releaseNotes:string|null;
    sourceSha:string|null;imageDigest:string|null;createdAt:string;note:string}|null;
  workload:WorkloadObservation|null;httpReachable:boolean|null;accessUrl:string|null;
};
const stateLabel:Record<HostedRuntimeState,string>={
  READY:"运行正常",DEPLOYING:"正在发布",DEGRADED:"发现运行异常",
  NOT_DEPLOYED:"尚未部署",UNKNOWN:"运行状态暂不可读"
};
function localTime(raw:string|null|undefined){return raw?new Date(raw).toLocaleString("zh-CN"):"—";}
export function HostedRuntimePanel({root}:{root:string}){
  const [environment,setEnvironment]=useState<HostedEnvironment>("PRODUCTION");
  const [revision,setRevision]=useState(0);
  const [data,setData]=useState<Runtime|null>(null);
  const [busy,setBusy]=useState(true),[error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    const load=async()=>{
      try{
        const response=await fetch(root+"/hosted/runtime?environment="+environment,{
          cache:"no-store",signal:controller.signal
        });
        if(!response.ok)throw new Error([401,403,404].includes(response.status)
          ?"无权读取此应用的运行状态":"运行状态请求失败");
        const result=await response.json() as Runtime;
        if(controller.signal.aborted)return;
        setData(result);setError("");
      }catch(e){
        if(!controller.signal.aborted){setData(null);setError(e instanceof Error?e.message:"运行状态暂不可读");}
      }finally{if(!controller.signal.aborted)setBusy(false);}
    };
    void load();
    return()=>controller.abort();
  },[root,environment,revision]);
  // Keep the selected environment current while the operator watches a rollout.
  useEffect(()=>{
    const timer=setInterval(()=>{if(!document.hidden)setRevision(x=>x+1);},30000);
    return()=>clearInterval(timer);
  },[]);
  function selectEnvironment(next:HostedEnvironment){
    if(next===environment)return;
    setData(null);setBusy(true);setError("");setEnvironment(next);
  }
  function refresh(){setBusy(true);setRevision(x=>x+1);}
  return <div className="ops-workspace">
    <section className="ops-topline">
      <div><p className="eyebrow">运行中心 / 应用状态</p><h2>运行状态</h2>
        <p className="muted">默认展示生产环境的实际 Kubernetes 状态，可切换查看测试环境。</p></div>
      <div className="actions">
        <button type="button" aria-pressed={environment==="PRODUCTION"}
          className={environment==="PRODUCTION"?"button":"button-secondary"}
          onClick={()=>selectEnvironment("PRODUCTION")}>生产环境</button>
        <button type="button" aria-pressed={environment==="TEST"}
          className={environment==="TEST"?"button":"button-secondary"}
          onClick={()=>selectEnvironment("TEST")}>测试环境</button>
        <button type="button" className="button-secondary" onClick={refresh}
          disabled={busy}>{busy?"读取中…":"刷新状态"}</button>
      </div>
    </section>
    {error&&<p className="card" role="alert">{error}。可点击“刷新状态”重试。</p>}
    {busy&&!data&&<section className="card ops-empty"><p role="status">正在读取{environment==="PRODUCTION"?"生产":"测试"}环境的实际运行状态…</p></section>}
    {data&&<div className="stack" aria-live="polite">
      <section className="ops-health-banner">
        <div><p className="eyebrow">{environment==="PRODUCTION"?"生产环境":"测试环境"} · {localTime(data.observedAt)}</p>
          <h3 className={"ops-health "+(data.state==="READY"?"ok":data.state==="DEGRADED"?"problem":"unknown")}>
            {stateLabel[data.state]}
          </h3><p className="muted">{data.reason}</p></div>
        <span className="tag">{data.state}</span>
      </section>
      {data.state==="NOT_DEPLOYED"?<section className="card ops-empty">
        <h3>{environment==="PRODUCTION"?"生产环境尚未发布":"测试环境尚未发布"}</h3>
        <p>{environment==="PRODUCTION"
          ?"先在「发布」页选择一个已验证的测试版本发布生产。也可以切换到测试环境查看正在运行的版本。"
          :"请先到「发布」页选择源码版本并完成测试部署。"}</p>
        <div className="actions">
          <Link className="button" href="?view=releases">前往发布</Link>
          {environment==="PRODUCTION"&&<button type="button" className="button-secondary"
            onClick={()=>selectEnvironment("TEST")}>查看测试环境</button>}
        </div>
      </section>:<>
        <section className="ops-signal-grid">
          <div className="card ops-signal"><span>当前版本</span>
            <strong>{data.release?.versionLabel??"未记录"}</strong>
            <small>{data.release?.status??"无发布记录"}</small></div>
          <div className="card ops-signal"><span>就绪 Pod</span>
            <strong>{data.workload?data.workload.available+"/"+data.workload.desired:"—"}</strong>
            <small>{data.workload?"Kubernetes 实时 Deployment":"尚未取得部署数据"}</small></div>
          <div className="card ops-signal"><span>HTTP 服务</span>
            <strong>{data.httpReachable===true?"访问成功":data.httpReachable===false?"访问失败":"未验证"}</strong>
            <small>{data.port?"NodePort "+data.port:"未分配端口"}</small></div>
          <div className="card ops-signal"><span>镜像一致性</span>
            <strong>{!data.workload?"未读取":data.workload.image===data.verifiedDigest&&!!data.verifiedDigest?"匹配":"不匹配"}</strong>
            <small>实际部署与已验证 Digest 对比</small></div>
        </section>
        <section className="card">
          <div className="section-title"><h3>部署详情</h3>
            {data.accessUrl&&<a href={data.accessUrl} target="_blank" rel="noopener noreferrer">访问应用 →</a>}</div>
          <p>命名空间：<code>{data.namespace}</code></p>
          <p>发布说明：{data.release?.releaseNotes??"—"}</p>
          <p>源码 Commit：<code>{data.release?.sourceSha??"—"}</code></p>
          <p>已验证镜像：<code className="ops-break">{data.verifiedDigest??"—"}</code></p>
          <p>实际镜像：<code className="ops-break">{data.workload?.image??"—"}</code></p>
          <p className="muted">就绪与运行状态取自 Kubernetes；不把上一次 READY 记录自动当成当前健康。</p>
        </section>
      </>}
    </div>}
  </div>;
}
