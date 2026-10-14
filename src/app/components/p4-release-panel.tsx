"use client";
import { useState } from "react";
export function P4ReleasePanel({ root }: { root: string }) {
  const [runId, setRunId] = useState("");
  const [variant, setVariant] = useState("healthy");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function dispatch() {
    if (busy) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(root + "/devops/promote", {
        method: "POST", headers: { "content-type": "application/json" },
        cache: "no-store", body: JSON.stringify({ publicationRunId: runId.trim(), variant }),
      });
      const result = await response.json() as { note?: string; error?: string };
      if (!response.ok) throw new Error(
        result.error === "p4_operator_required" ? "账号不在 P4 实验发布操作者名单中。"
        : result.error === "p4_dispatch_not_configured" ? "服务端未配置 GitHub 派发令牌。"
        : result.error === "p4_test_environment_required" ? "请先登记有效的 TEST 环境。"
        : result.error === "p4_application_not_bound" ? "请先将该应用的 TEST 环境关联到 marketplace-lab Argo Application，并确保 Argo 可读。"
        : "派发失败：请核对 Run ID、发布权限及默认分支上的工作流。");
      setMessage(result.note ?? "派发请求已接受。");
    } catch (e) { setError(e instanceof Error ? e.message : "派发失败。"); }
    finally { setBusy(false); }
  }
  async function rollout(action: "promote-full" | "abort") {
    if (busy || !window.confirm(action === "promote-full"
      ? "确认在测试环境执行 Argo Rollouts 全量切流？请先核查 preview 与健康状态。"
      : "确认中止当前实验 Rollout 的发布进度？")) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(root + "/devops/rollout", {
        method: "POST", headers: { "content-type": "application/json" },
        cache: "no-store", body: JSON.stringify({ action }),
      });
      const result = await response.json() as { note?: string; error?: string };
      if (!response.ok) throw new Error(
        result.error === "p4_operator_required" ? "当前账号没有实验发布操作权限。"
        : result.error === "p4_application_not_bound" ? "应用与 Argo 测试环境未正确关联。"
        : result.error === "p4_rollout_not_ready" ? "Argo 未同步或健康状态不足以切流，操作已拒绝。"
        : "Argo 操作失败；请检查独立动作令牌以及 Rollout 状态。");
      setMessage(result.note ?? "Argo 已接受操作请求，请重新读取运行状态。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { setBusy(false); }
  }
  return <section className="card asset-group" aria-label="P4实验GitOps发布">
    <h3>发布到测试环境 · GitOps PR</h3>
    <p className="muted">输入可信 GHCR 发布 Run ID，GitHub Actions 将验证来源并创建 GitOps 镜像 Digest PR。门户不会直接访问 Kubernetes。</p>
    <div className="stack">
      <label>可信镜像发布 Run ID
        <input value={runId} onChange={e => setRunId(e.target.value)} inputMode="numeric" pattern="[1-9][0-9]*" placeholder="lab-publish 工作流 Run ID" />
      </label>
      <label>发布镜像
        <select value={variant} onChange={e => setVariant(e.target.value)}>
          <option value="healthy">healthy · 正常发布</option>
          <option value="unhealthy">unhealthy · 故障演练</option>
        </select>
      </label>
      <div className="actions">
        <button type="button" disabled={busy || !/^[1-9][0-9]{0,18}$/.test(runId.trim())} onClick={() => void dispatch()}>
          {busy ? "请求中…" : "发起 GitOps 发布 PR"}
        </button>
        <a href="https://github.com/NoName4Me/enterprise-app-marketplace/actions/workflows/p4-gitops-promote.yml"
           target="_blank" rel="noopener noreferrer">查看发布工作流</a>
      </div>
      <div className="actions">
        <button className="button-secondary" type="button" disabled={busy} onClick={() => void rollout("promote-full")}>
          Argo 确认切流
        </button>
        <button className="button-secondary" type="button" disabled={busy} onClick={() => void rollout("abort")}>
          Argo 中止当前发布
        </button>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted">仅测试环境、仅受授权的 owner 与 P4 操作者可发起。PR 合并、Argo 同步和人工确认切流是独立步骤。切流/中止均使用 Argo CD 内置资源动作。</p>
    </div>
  </section>;
}
