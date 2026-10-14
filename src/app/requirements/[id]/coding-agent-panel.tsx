"use client";
import { useState } from "react";
type Data = { state: string; repository: string | null; externalTaskId: string | null;
  note: string; source: string };
export function CodingAgentPanel({ requirementId }: { requirementId: string }) {
  const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function call(method:"GET"|"POST"){
    if(busy)return;
    if(method==="POST"&&!window.confirm("确认委托 GitHub Copilot Cloud Agent 在 dev 的隔离分支编码并创建 PR？不会自动合并或发布。"))return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/requirements/"+requirementId+"/coding-task",{
        method,cache:"no-store",...(method==="POST"?{headers:{"Content-Type":"application/json"},body:"{}"}:{})
      });
      const value=await response.json() as Data & {error?:string};
      if(!response.ok)throw new Error(value.error==="p5_copilot_not_configured"?"尚未配置 Copilot User Token。":
        value.error==="coding_repository_not_unique"?"需要一个已登记且在 P5_ALLOWED_REPOS 中的唯一 GitHub 仓库。":
        value.error==="coding_task_exists"?"已派发该需求的编码任务，不允许重复创建。":
        "不能启动编码任务，请检查授权、需求状态和 GitHub 访问。");
      setData(value);
    }catch(e){setError(e instanceof Error?e.message:"请求失败")}
    finally{setBusy(false)}
  }
  return <section className="card"><h3>P5 · 云端 AI 编码</h3>
    <p className="muted">调用 GitHub Copilot Coding Agent；不在门户运行任意代码，不自建 Code RAG / 修复器。完成后由人工检查 PR 与 CI。</p>
    <div className="actions">
      <button type="button" disabled={busy} onClick={()=>void call("POST")}>{busy?"处理中…":"交给 Coding Agent"}</button>
      <button type="button" disabled={busy} className="button-secondary" onClick={()=>void call("GET")}>刷新任务状态</button>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {data&&<div className="asset-row"><p>状态：{data.state} · 来源：{data.source??"GitHub"}</p>
      {data.repository&&<p>仓库：<a href={"https://github.com/"+data.repository} target="_blank" rel="noopener noreferrer">{data.repository}</a></p>}
      {data.externalTaskId&&<p>任务 ID：{data.externalTaskId}</p>}
      <p className="muted">{data.note}</p>
    </div>}
  </section>;
}
