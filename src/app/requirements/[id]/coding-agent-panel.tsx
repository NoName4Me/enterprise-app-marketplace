"use client";
import { useState } from "react";
type Snapshot = {
  stage: string;
  plan: string | null;
  repository: string;
  externalTaskId: string | null;
  reviewedPrUrl?: string;
  reviewedMergeSha?: string;
  note: string;
  lastCheckedAt: string | null;
};
type Release = {id:string;status:string;versionLabel:string|null;releaseNotes:string|null;sourceSha:string|null;imageDigest:string|null;updatedAt:string};
type ResponseData = { state: string; workflowId?: string; snapshot?: Snapshot; note?: string; error?: string;releases?:Release[] };
export function CodingAgentPanel({ requirementId, appId }: { requirementId: string;appId:string }) {
  const [value,setValue] = useState<ResponseData|null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [prNumber,setPrNumber] = useState("");
  async function send(method: "GET"|"POST"|"PATCH", decision?: "APPROVE"|"REJECT"|"VERIFY_PR"|"START_TEST_RELEASE") {
    if (busy) return;
    if (decision==="APPROVE" && !confirm("确定按已展示方案启动云端 Coding Agent？编码后仍需独立 PR/CI 审核。")) return;
    if (decision==="START_TEST_RELEASE" && !confirm("确认将此需求的已验证代码构建并部署到 TEST？构建前将核验所选源码包含已审核的提交。")) return;
    setBusy(true);setError("");
    try {
      const r=await fetch("/api/requirements/"+requirementId+"/coding-task", {
        method,cache:"no-store",
        ...(method==="GET" ? {} : {headers: {"Content-Type":"application/json"},
          body: JSON.stringify(decision==="VERIFY_PR"?{decision,prNumber:Number(prNumber)}:decision?{decision}:{})}),
      });
      const d=await r.json() as ResponseData;
      if (!r.ok) throw new Error(
        d.error === "temporal_unavailable" ? "Temporal 服务不可用，请检查 Worker 与本地服务。" :
        d.error === "coding_task_exists" ? "该需求已有编码任务，不能重复启动。" :
        d.error === "coding_repository_not_unique" ? "请登记唯一的有效 GitHub 仓库并加入白名单。" :
        d.error === "delivery_not_ready" || d.error === "delivery_test_not_ready" ? "尚未验证 PR、CI 与交付来源，不能启动测试发布。" :
        d.error === "release_in_progress" ? "该应用测试环境已有未结束的发布，请先核对状态。" :
        d.error === "hosted_repository_not_allowed" ? "管理员尚未授权此仓库构建与部署。" :
        "请求失败，请检查应用负责人权限或工作流状态。");
      if(decision==="START_TEST_RELEASE"){
        const state=await fetch("/api/requirements/"+requirementId+"/coding-task",{cache:"no-store"});
        setValue(state.ok?await state.json() as ResponseData:d);
      } else setValue(d);
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
        {value.snapshot.reviewedPrUrl&&<p><a href={value.snapshot.reviewedPrUrl} target="_blank" rel="noopener noreferrer">已验证的 PR</a></p>}
        {value.snapshot.reviewedMergeSha&&<p>经核验的 PR 合并 SHA：<code>{value.snapshot.reviewedMergeSha}</code></p>}
        {value.snapshot.stage==="AWAITING_PR_REVIEW"&&<div className="stack">
          <label>PR 编号<input type="number" min={1} step={1} value={prNumber} onChange={e=>setPrNumber(e.target.value)} /></label>
          <button type="button" disabled={busy||!/^[1-9][0-9]{0,8}$/.test(prNumber)}
            onClick={()=>void send("PATCH","VERIFY_PR")}>通过 GitHub 核验 PR 与 CI</button>
        </div>}
        {value.snapshot.stage==="AWAITING_TEST_RELEASE"&&<div className="stack">
          <p>编码 PR/CI 已确认。TEST 构建前将重新验证选定代码包含该提交，发布由 Kubernetes 直接执行。</p>
          <button type="button" disabled={busy||value.releases?.some(r=>r.status==="READY"||
            ["REQUESTING","BUILDING","DEPLOYING","NEEDS_RECONCILIATION"].includes(r.status))}
            onClick={()=>void send("PATCH","START_TEST_RELEASE")}>部署此需求到 TEST</button>
        </div>}
        {value.snapshot.stage==="AWAITING_APPROVAL"&&<div className="actions">
          <button disabled={busy} type="button" onClick={()=>void send("PATCH","APPROVE")}>确认计划并派发</button>
          <button disabled={busy} type="button" className="button-secondary" onClick={()=>void send("PATCH","REJECT")}>拒绝计划</button>
        </div>}
      </>}
      {!!value.releases?.length&&<div className="stack">
        <h4>关联的 TEST 发布记录</h4>
        {value.releases.map(r=><article className="asset-row" key={r.id}>
          <strong>{r.versionLabel??"未命名版本"} · {r.status}</strong> · <span className="muted">{new Date(r.updatedAt).toLocaleString("zh-CN")}</span>
          {r.releaseNotes&&<p>{r.releaseNotes}</p>}
          {r.sourceSha&&<p>构建源码：<code>{r.sourceSha}</code></p>}
          {r.imageDigest&&<p>不可变镜像：<code>{r.imageDigest}</code></p>}
        </article>)}
        <a href={"/my/apps/"+appId+"?view=releases"}>查看应用完整发布记录 →</a>
      </div>}
      {value.note&&<p className="muted">{value.note}</p>}
      <p className="muted">TEST READY 表示 Worker 已完成 Kubernetes 镜像、Pod 和 HTTP 验证；不代表已完成生产晋级、LAN 客户端或自动回滚验收。</p>
    </div>}
  </section>;
}
