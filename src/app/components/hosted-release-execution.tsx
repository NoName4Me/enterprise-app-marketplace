"use client";
import {useCallback,useEffect,useState} from "react";

type Release={
  id:string;environment:"TEST"|"PRODUCTION";status:string;
  sourceSha:string|null;imageDigest:string|null;buildRunId:string|null;
  gitopsPrNumber:number|null;note:string;
};
type Step={name:string;number:number;status:string;conclusion:string|null;startedAt:string|null;completedAt:string|null};
type Job={id:number;name:string;status:string;conclusion:string|null;steps:Step[]};
type Execution={
  release:Release;
  snapshot:{stage:string;note:string}|null;
  build:{state:"OK"|"NO_BUILD"|"UNAVAILABLE";jobs:Job[];note?:string};
  deployment:{source:string;state:"OK"|"NOT_CONNECTED"|"UNKNOWN";applications:{
    name:string;sync:string;health:string;operationPhase:string|null;
    lastSyncedRevision:string|null;lastSyncedAt:string|null;namespace:string;
  }[]};
  observedAt:string;
};
type StageStatus="done"|"current"|"waiting"|"pending"|"failed";
type Phase={title:string;status:StageStatus;description:string};

function phaseStatus(done:boolean,current:boolean,failed:boolean,waiting=false):StageStatus{
  return done?"done":failed?"failed":waiting?"waiting":current?"current":"pending";
}
function phases(r:Release,stage:string):Phase[]{
  const failed=r.status==="FAILED"||r.status==="NEEDS_RECONCILIATION";
  const buildDone=r.environment==="PRODUCTION"||!!r.imageDigest;
  const inBuild=r.status==="BUILDING"||stage==="BUILDING"||stage==="WAITING_BUILD";
  const prDone=["SYNCING","VERIFYING","READY"].includes(stage)||r.status==="READY";
  const prPending=["OPENING_PR","AWAITING_PR"].includes(stage)||r.status==="WAITING_PR";
  const deployDone=r.status==="READY";
  const deployActive=["SYNCING","VERIFYING"].includes(stage)||r.status==="DEPLOYING";
  const stages:Phase[]=[
    {title:r.environment==="TEST"?"获取源码、测试与构建镜像":"复用已验证的测试镜像",
      status:phaseStatus(buildDone,inBuild,failed&&!buildDone),
      description:buildDone?"已绑定不可变镜像":"等待可信 CI、构建与镜像校验"},
    {title:"提交发布变更与审核",
      status:phaseStatus(prDone,prPending,failed&&buildDone&&!prDone,stage==="AWAITING_PR"),
      description:stage==="AWAITING_PR"?"需要有权人员审核 GitOps PR":"通过 GitOps 审计目标部署版本"},
    {title:"同步并启动服务器容器",
      status:phaseStatus(deployDone,deployActive&&stage!=="VERIFYING",failed&&prDone&&!deployDone),
      description:"Mac mini Kubernetes / Argo CD"},
    {title:"核验服务与访问入口",
      status:phaseStatus(deployDone,stage==="VERIFYING",failed&&stage==="VERIFYING"),
      description:"核对镜像、Pod Ready 与 NodePort HTTP"}
  ];
  return stages;
}
const statusText:Record<StageStatus,string>={
  done:"完成",current:"执行中",waiting:"待人工审核",pending:"等待",failed:"未完成"
};
function jobState(status:string,conclusion:string|null){
  if(conclusion==="success")return "已完成";
  if(conclusion==="failure"||conclusion==="cancelled"||conclusion==="timed_out")return "失败";
  if(status==="in_progress")return "执行中";
  return "等待";
}
function showTime(value:string|null){
  if(!value)return "";
  return new Date(value).toLocaleTimeString("zh-CN",{hour12:false});
}

export function HostedReleaseExecution({root,release}:{root:string;release:Release}){
  const [expanded,setExpanded]=useState(false);
  const [execution,setExecution]=useState<Execution|null>(null);
  const [error,setError]=useState("");
  const [logs,setLogs]=useState<Record<string,{state:string;text:string;note?:string}>>({});
  const [loadingLog,setLoadingLog]=useState<string|null>(null);
  const endpoint=root+"/hosted/releases/"+release.id;
  const refresh=useCallback(async()=>{
    try{
      const response=await fetch(endpoint+"/execution",{cache:"no-store"});
      if(!response.ok)throw new Error("读取执行详情失败");
      setExecution(await response.json() as Execution);
      setError("");
    }catch{setError("执行详情暂不可读取，请稍后刷新");}
  },[endpoint]);
  useEffect(()=>{
    if(!expanded)return;
    void refresh();
    const timer=setInterval(()=>{void refresh();},8000);
    return ()=>clearInterval(timer);
  },[expanded,refresh]);
  async function fetchLog(jobId:number){
    const key=String(jobId);
    if(loadingLog)return;
    setLoadingLog(key);
    try{
      const response=await fetch(endpoint+"/logs?jobId="+key,{cache:"no-store"});
      if(!response.ok)throw new Error("日志接口不可用");
      const result=await response.json() as {state:string;text:string;note?:string};
      setLogs(current=>({...current,[key]:result}));
    }catch{
      setLogs(current=>({...current,[key]:{state:"UNAVAILABLE",text:"",note:"日志暂不可读取"}}));
    }
    finally{setLoadingLog(null);}
  }
  const current=execution?.release??release;
  const stage=execution?.snapshot?.stage??"";
  return <details className="release-execution" onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary>构建及发布流程 · 查看步骤与日志</summary>
    <div className="release-execution-body">
      <ol className="release-steps">{phases(current,stage).map((phase,index)=>
        <li key={index} data-state={phase.status}>
          <span className="release-step-marker" aria-hidden="true">{index+1}</span>
          <div><strong>{phase.title}</strong><p>{phase.description}</p></div>
          <span className="release-step-state">{statusText[phase.status]}</span>
        </li>)}</ol>
      <p className="muted">{execution?.snapshot?.note??current.note}</p>
      <div className="section-title">
        <h5>构建步骤和作业日志</h5>
        <button type="button" className="button-secondary" onClick={()=>void refresh()}>更新详情</button>
      </div>
      {!execution&&!error&&<p className="muted">正在读取构建步骤…</p>}
      {error&&<p role="status" className="muted">{error}</p>}
      {execution?.build.state==="NO_BUILD"&&
        <p className="muted">{current.environment==="PRODUCTION"?
          "生产直接复用已验证的测试镜像，不重新构建。":"正在等待构建任务分配 Run ID。"}</p>}
      {execution?.build.state==="UNAVAILABLE"&&
        <p className="muted">{execution.build.note??"构建状态暂不可读取"}</p>}
      {execution?.build.state==="OK"&&!execution.build.jobs.length&&
        <p className="muted">构建已派发，等待 GitHub 分配作业。</p>}
      {execution?.build.jobs.map(job=><section key={job.id} className="release-job">
        <div className="release-job-title">
          <strong>{job.name}</strong><span className="muted">{jobState(job.status,job.conclusion)}</span>
        </div>
        <ol>{job.steps.map(step=><li key={step.number}>
          <span>{step.conclusion==="success"?"✓":step.conclusion==="failure"?"×":step.status==="in_progress"?"●":"○"}</span>
          <span>{step.name}</span><small>{jobState(step.status,step.conclusion)}</small>
          <time>{showTime(step.completedAt??step.startedAt)}</time>
        </li>)}</ol>
        <button type="button" className="button-secondary" disabled={loadingLog!==null}
          onClick={()=>void fetchLog(job.id)}>{loadingLog===String(job.id)?"读取日志中…":
          logs[String(job.id)]?"重新读取作业日志":"查看作业详细日志"}</button>
        {logs[String(job.id)]&&<div className="release-log-output">
          {logs[String(job.id)].note&&<p className="muted">{logs[String(job.id)].note}</p>}
          {logs[String(job.id)].text&&<pre>{logs[String(job.id)].text}</pre>}
        </div>}
      </section>)}
      <div className="section-title"><h5>服务器部署状态</h5><span className="muted">Argo CD 实时只读</span></div>
      {execution?.deployment.state==="NOT_CONNECTED"&&
        <p className="muted">门户尚未配置 Argo CD 只读接入，部署事实以已有 Temporal 验证记录为准。</p>}
      {execution?.deployment.state==="UNKNOWN"&&
        <p className="muted">Argo CD 暂不可读取，不能据此认定部署成功。</p>}
      {execution?.deployment.state==="OK"&&!execution.deployment.applications.length&&
        <p className="muted">此环境尚无已验证归属的 Argo Application，等待部署注册或同步。</p>}
      {execution?.deployment.applications.map(app=><div key={app.name} className="release-job">
        <strong>{app.name}</strong>
        <p>同步：{app.sync} · 健康：{app.health} · 操作：{app.operationPhase??"无进行中操作"}</p>
        <p className="muted">命名空间：{app.namespace} · 最近部署：
          {app.lastSyncedAt?new Date(app.lastSyncedAt).toLocaleString("zh-CN"):"未提供时间"}</p>
        {app.lastSyncedRevision&&<p className="muted">GitOps Revision：<code>{app.lastSyncedRevision.slice(0,12)}</code></p>}
      </div>)}
      <p className="muted">步骤约每 8 秒刷新。GitHub 原始日志可能延迟提供；执行状态不是逐行日志推送。Argo 同步和健康不等于应用访问验证。</p>
    </div>
  </details>;
}
