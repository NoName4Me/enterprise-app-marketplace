"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DevopsEvidence } from "@/domain/devops-evidence";
import type { Diagnosis } from "@/domain/devops-diagnosis";
import type {ReadyPodHistory} from "@/domain/ops-series";
import {OpsHistoryChart} from "./ops-history-chart";

function date(value:string|null|undefined){return value?new Date(value).toLocaleString("zh-CN"):"未知时间";}
function signal(state:"OK"|"NOT_CONNECTED"|"UNKNOWN"){
 return state==="OK"?"已连接":state==="NOT_CONNECTED"?"未接入":"暂不可读";
}
function incident(e:DevopsEvidence){
 const argo=e.argo.applications;
 if(argo.some(a=>a.health==="Degraded"||a.health==="Missing"))return {text:"发现部署异常",tone:"problem"};
 if(e.alerts.state==="OK"&&e.alerts.items.length>0)return {text:"有活动告警",tone:"problem"};
 if(!argo.length||e.argo.state!=="OK"||e.metrics.state!=="OK"||e.alerts.state!=="OK")
  return {text:"健康状况尚不完整",tone:"unknown"};
 return {text:"未发现已接入信号中的异常",tone:"ok"};
}
export function DevopsEvidencePanel({root,appId}:{root:string;appId?:string}){
 const router=useRouter();
 const [fixOpen,setFixOpen]=useState(false);
 const [fixTitle,setFixTitle]=useState("调查并修复应用运行异常");
 const [fixDescription,setFixDescription]=useState("");
 const [fixPending,setFixPending]=useState(false);
 const [data,setData]=useState<DevopsEvidence|null>(null),[diagnosis,setDiagnosis]=useState<Diagnosis|null>(null);
 const [busy,setBusy]=useState<"evidence"|"diagnose"|null>(null),[error,setError]=useState("");
 const [history,setHistory]=useState<ReadyPodHistory|null>(null);
 async function load(type:"evidence"|"diagnose"){
  if(busy)return;
  setBusy(type);setError("");
  try{
   const r=await fetch(root+"/devops/"+(type==="evidence"?"evidence":"diagnose"),{
    method:type==="evidence"?"GET":"POST",cache:"no-store",
   });
   if(!r.ok){setError([401,403,404].includes(r.status)?"无权读取此应用的私有运行资料。":"运行证据暂不可获取。");return;}
   const value=await r.json() as DevopsEvidence|{evidence:DevopsEvidence;diagnosis:Diagnosis};
   if("evidence" in value){setData(value.evidence);setDiagnosis(value.diagnosis);}
   else{setData(value);setDiagnosis(null);}
   if(appId){
     try {
       const trend=await fetch(root+"/devops/timeseries",{cache:"no-store"});
       setHistory(trend.ok?await trend.json() as ReadyPodHistory:null);
     }catch{setHistory(null);}
   }
  }catch{setError("无法访问运行服务，请检查网络连接。");}
  finally{setBusy(null);}
 }
 async function submitRepair(){
  if(!appId||fixPending)return;
  setFixPending(true);setError("");
  try{
   const response=await fetch("/api/requirements",{
     method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({type:"BUG",appId,title:fixTitle,description:fixDescription}),
   });
   if(!response.ok)throw new Error("创建修复需求失败，请确认应用负责人权限及内容长度。");
   const created=await response.json() as {id:string};
   router.push("/requirements/"+created.id);
  }catch(error){setError(error instanceof Error?error.message:"修复需求提交失败");}
  finally{setFixPending(false);}
 }
 const overview=data?incident(data):null;
 const first=data?.argo.applications[0];
 const ready=data?.metrics.items.find(x=>x.name==="namespace_ready_pods");
 const restart=data?.metrics.items.find(x=>x.name==="namespace_container_restarts");
 const ci=data?.github.references.flatMap(x=>x.runs.items)[0];
 const timeline=data?[...data.alerts.items.map(a=>({key:"alert-"+a.name,time:a.activeAt,title:"告警："+a.name,
     text:a.summary||a.state})),
   ...data.argo.applications.filter(a=>a.lastSyncedAt).map(a=>({key:"sync-"+a.name,time:a.lastSyncedAt,
    title:"GitOps 同步："+a.name,text:"revision "+(a.lastSyncedRevision??"未知")}))]
   .sort((a,b)=>(b.time??"").localeCompare(a.time??"")).slice(0,7):[];
 return <div className="ops-workspace">
  <section className="ops-topline">
   <div><p className="eyebrow">运行中心 / 应用状态</p><h2>健康与事件</h2>
    <p className="muted">结合部署、告警、指标和最近变更查看应用状态。所有事实来自有权限的外部系统。</p></div>
   <div className="actions">
    <button type="button" className="button-secondary" disabled={!!busy} onClick={()=>void load("evidence")}>
     {busy==="evidence"?"读取中…":"刷新运行数据"}</button>
    <button type="button" disabled={!!busy} onClick={()=>void load("diagnose")}>
     {busy==="diagnose"?"分析中…":"AI 分析当前状态"}</button>
   </div>
  </section>
  {error&&<p role="alert" className="error">{error}</p>}
  {!data?<section className="card ops-empty">
   <h3>先读取真实运行状态</h3>
   <p>平台将尝试访问该应用对应的 Argo CD、Prometheus、Loki 和 GitHub。尚未接入时不会显示虚假的健康状态。</p>
   <button onClick={()=>void load("evidence")} disabled={!!busy} type="button">读取应用状态</button>
  </section>:<>
   <section className="ops-health-banner">
    <div><p className="eyebrow">综合信号 · {date(data.collectedAt)}</p>
     <h3 className={"ops-health "+overview?.tone}>{overview?.text}</h3>
     <p className="muted">综合结果只覆盖已接入的数据源，不等于端到端用户访问验证。</p></div>
    <span className="tag">Argo：{data.argo.state==="OK"?"已连接":signal(data.argo.state)}</span>
   </section>
   <div className="ops-signal-grid">
    <div className="card ops-signal"><span>部署状态</span><strong>{first?(first.health==="Healthy"?"资源健康":first.health):"未知"}</strong>
      <small>Argo CD · {data.argo.applications.length} 个关联应用</small></div>
    <div className="card ops-signal"><span>活动告警</span><strong>{data.alerts.state==="OK"?data.alerts.items.length:"—"}</strong>
      <small>Prometheus · {signal(data.alerts.state)}</small></div>
    <div className="card ops-signal"><span>就绪容器 / Pod</span><strong>{ready?.value??"—"}</strong>
      <small>Prometheus · {signal(data.metrics.state)}</small></div>
    <div className="card ops-signal"><span>最近 CI</span><strong>{ci?.conclusion??ci?.status??"—"}</strong>
      <small>GitHub · 与部署成功分开判断</small></div>
   </div>
   {history&&<OpsHistoryChart history={history}/>}
   <div className="ops-main-grid">
    <div className="stack">
     <section className="card">
       <div className="section-title"><h3>正在发生的事情</h3><span className="tag">{data.alerts.items.length} 条告警</span></div>
       {data.alerts.state!=="OK"&&<p className="muted">告警来源：{signal(data.alerts.state)}。不能判断为无告警。</p>}
       {data.alerts.state==="OK"&&!data.alerts.items.length&&<p className="muted">已接入范围内暂无活跃告警。</p>}
       {data.alerts.items.map((a,i)=><article className="ops-incident" key={a.name+"-"+i}>
         <span className="ops-incident-dot" aria-hidden="true"/><div><strong>{a.name}</strong>
          <p>{a.summary||a.severity+" · "+a.state}</p><small>{date(a.activeAt)}</small></div>
       </article>)}
     </section>
     <section className="card">
      <h3>近期运行事件</h3>
      {!timeline.length&&<p className="muted">没有可确定时间的运行事件；接入部署或告警源后将显示时间线。</p>}
      <div className="ops-timeline">{timeline.map(item=><article key={item.key}>
       <time>{date(item.time)}</time><strong>{item.title}</strong><p>{item.text}</p>
      </article>)}</div>
     </section>
     <section className="card">
      <div className="section-title"><h3>部署与运行证据</h3><span className="tag">{signal(data.metrics.state)}</span></div>
      <p className="muted">{data.scopeNote}</p>
      {data.argo.applications.map(a=><div className="ops-proof" key={a.name}>
       <strong>{a.name} · {a.environmentName}</strong>
       <p>资源健康：{a.health} · GitOps 同步：{a.sync} · 镜像：{a.images.join(", ")||"尚未读取"}</p>
      </div>)}
      {restart&&<p className="muted">容器累计重启：{restart.value} · 采样时间：{date(restart.sampledAt)}</p>}
      <details><summary>查看日志样本与原始信号</summary>
       <p>日志来源：{signal(data.logs.state)} · 最近有限样本，不代表完整日志。</p>
       {!data.logs.items.length&&<p className="muted">暂无可读日志。</p>}
       {data.logs.items.slice(0,12).map((l,i)=><p key={i} className="ops-logline">{date(l.at)} · {l.line}</p>)}
       <p>代码来源：GitHub；{data.github.references.length} 个可关联引用。</p>
      </details>
     </section>
    </div>
    <aside className="card ops-ai-panel">
      <p className="eyebrow">AI · 诊断助手</p><h3>根据实际证据分析问题</h3>
      <p className="muted">把部署变化、活动告警和近期 CI 组合起来，区分观察事实、可能原因与下一步验证。</p>
      <button disabled={!!busy} onClick={()=>void load("diagnose")} type="button">
       {busy==="diagnose"?"正在分析…":"开始 AI 诊断"}</button>
      {diagnosis?<div className="ops-ai-result" aria-live="polite">
       <p className="muted">结果：{diagnosis.state} · 模型：{diagnosis.model??"未连接"} · {date(diagnosis.generatedAt)}</p>
       <div className="pre-wrap">{diagnosis.text}</div>
       <p className="muted">{diagnosis.note}</p>
       {appId&&diagnosis.state==="OK"&&<div className="ops-repair-actions">
        <button type="button" className="button-secondary" onClick={()=>{
          setFixDescription(("AI 初步诊断（尚未经人工验证）：\n"+
            diagnosis.text.slice(0,3200)+"\n\n请先核验事实、确认修复范围和回归测试标准。").slice(0,3800));
          setFixOpen(true);
        }}>整理为修复需求</button>
        {fixOpen&&<div className="stack ops-repair-form">
         <label>修复任务标题<input minLength={5} maxLength={140} value={fixTitle}
            onChange={e=>setFixTitle(e.target.value)}/></label>
         <label>待确认的修复说明<textarea rows={8} minLength={10} maxLength={4000}
            value={fixDescription} onChange={e=>setFixDescription(e.target.value)}/></label>
         <p className="muted">提交后形成与此应用关联的 BUG 需求；后续须人工审核方案，才能经 Temporal 派发编码任务，不会直接在服务器上执行修复。</p>
         <button type="button" disabled={fixPending||fixTitle.length<5||fixDescription.length<10}
            onClick={()=>void submitRepair()}>{fixPending?"提交中…":"确认创建修复需求"}</button>
        </div>}
       </div>}
      </div>:<p className="muted">尚未生成诊断。AI 不会在未经审批的情况下修改代码、重启或发布应用。</p>}
    </aside>
   </div>
  </>}
 </div>;
}
