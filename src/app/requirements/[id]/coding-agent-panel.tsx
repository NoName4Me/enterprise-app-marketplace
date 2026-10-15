"use client";
import { useState } from "react";
type Snapshot = {
  stage: string;
  plan: string | null;
  repository: string;
  externalTaskId: string | null;
  note: string;
  lastCheckedAt: string | null;
};
type ResponseData = { state: string; workflowId?: string; snapshot?: Snapshot; note?: string; error?: string };
export function CodingAgentPanel({ requirementId }: { requirementId: string }) {
  const [value,setValue] = useState<ResponseData|null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  async function send(method: "GET"|"POST"|"PATCH", decision?: "APPROVE"|"REJECT") {
    if (busy) return;
    if (decision==="APPROVE" && !confirm("确定按已展示方案启动云端 Coding Agent？编码后仍需独立 PR/CI 审核。")) return;
    setBusy(true);setError("");
    try {
      const r=await fetch("/api/requirements/"+requirementId+"/coding-task", {
        method,cache:"no-store",
        ...(method==="GET" ? {} : {headers: {"Content-Type":"application/json"},
          body: JSON.stringify(decision ? {decision} : {})}),
      });
      const d=await r.json() as ResponseData;
      if (!r.ok) throw new Error(
        d.error === "temporal_unavailable" ? "Temporal 服务不可用，请检查 Worker 与本地服务。" :
        d.error === "coding_task_exists" ? "该需求已有编码任务，不能重复启动。" :
        d.error === "coding_repository_not_unique" ? "请登记唯一的有效 GitHub 仓库并加入白名单。" :
        d.error === "delivery_not_ready" ? "流程尚未进入可审批阶段。" :
        "请求失败，请检查应用负责人权限或工作流状态。");
      setValue(d);
    } catch(e) {setError(e instanceof Error?e.message:"操作失败");}
    finally {setBusy(false);}
  }
  return <section className="card"><h3>P5 · Temporal AI 交付工作流</h3>
    <p className="muted">Temporal 保存持久进度、人工审批与外部任务结果。模型负责需求建议；Coding Agent 执行编码。没有通过审批不会触发代码修改。</p>
    <div className="actions">
      <button disabled={busy} type="button" onClick={()=>void send("POST")}>启动交付工作流</button>
      <button disabled={busy} type="button" className="button-secondary" onClick={()=>void send("GET")}>刷新实时状态</button>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {value&&<div className="asset-row">
      <p>工作流：{value.state} · {value.workflowId??"尚未创建"}</p>
      {value.snapshot&&<>
        <p>阶段：<strong>{value.snapshot.stage}</strong> · 仓库：{value.snapshot.repository}</p>
        <p className="muted">{value.snapshot.note}</p>
        {value.snapshot.plan&&<article><h4>待确认的实施建议</h4><p className="pre-wrap">{value.snapshot.plan}</p></article>}
        {value.snapshot.externalTaskId&&<p>GitHub 外部任务 ID：{value.snapshot.externalTaskId}</p>}
        {value.snapshot.stage==="AWAITING_APPROVAL"&&<div className="actions">
          <button disabled={busy} type="button" onClick={()=>void send("PATCH","APPROVE")}>确认计划并派发</button>
          <button disabled={busy} type="button" className="button-secondary" onClick={()=>void send("PATCH","REJECT")}>拒绝计划</button>
        </div>}
      </>}
      {value.note&&<p className="muted">{value.note}</p>}
      <p className="muted">最终发布并未自动完成：PR 审查、CI 与 Argo 发布需后续独立验证。</p>
    </div>}
  </section>;
}
