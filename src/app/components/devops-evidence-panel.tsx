"use client";

import { useState } from "react";
import type { DevopsEvidence } from "@/domain/devops-evidence";
import type { Diagnosis } from "@/domain/devops-diagnosis";

function when(value: string | null): string { return value ? new Date(value).toLocaleString("zh-CN") : "未提供"; }
const metricLabels: Record<string, string> = {
  namespace_ready_pods: "就绪 Pod 数（专用实验命名空间）",
  namespace_container_restarts: "容器累计重启次数（专用实验命名空间）",
};
export function DevopsEvidencePanel({ root }: { root: string }) {
  const [data, setData] = useState<DevopsEvidence | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [busy, setBusy] = useState<"evidence" | "diagnose" | null>(null);
  const [error, setError] = useState("");
  async function load(action: "evidence" | "diagnose") {
    if (busy) return;
    setBusy(action);
    setError("");
    try {
      const response = await fetch(root + "/devops/" + (action === "evidence" ? "evidence" : "diagnose"), {
        method: action === "evidence" ? "GET" : "POST",
        cache: "no-store",
      });
      if (!response.ok) {
        setError([401, 403, 404].includes(response.status) ? "当前账号无权读取本应用的运维资料。" : "读取外部系统失败。");
        return;
      }
      const payload = await response.json() as DevopsEvidence | { evidence: DevopsEvidence; diagnosis: Diagnosis };
      if ("evidence" in payload) {
        setData(payload.evidence);
        setDiagnosis(payload.diagnosis);
      } else {
        setData(payload);
        setDiagnosis(null);
      }
    } catch {
      setError("访问运维服务失败。");
    } finally {
      setBusy(null);
    }
  }
  return <section id="devops" className="card asset-group" aria-label="AI DevOps 运行分析">
    <h3>AI DevOps · 运行证据与诊断</h3>
    <p className="muted">只读汇总该应用的 Argo CD、GitHub、Prometheus 和 Loki。AI 分析使用显式配置的本地 Ollama，不执行代码修改或发布。</p>
    <div className="actions">
      <button className="button-secondary" type="button" disabled={!!busy} onClick={() => void load("evidence")}>
        {busy === "evidence" ? "读取中…" : "读取运维证据"}
      </button>
      <button type="button" disabled={!!busy} onClick={() => void load("diagnose")}>
        {busy === "diagnose" ? "诊断中…" : "AI 只读诊断"}
      </button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {data && <div className="stack">
      <p className="muted">证据获取：{when(data.collectedAt)} · {data.scopeNote}</p>
      <div className="asset-row">
        <strong>运行状态 · Argo CD（{data.argo.state}）</strong>
        {!data.argo.applications.length && <p className="muted">没有可归属的运行状态；不得把未知当作健康。</p>}
        {data.argo.applications.map(app => <p key={app.project + "/" + app.name}>
          {app.name} / {app.environmentName}：{app.sync} · {app.health} · 最近同步版本 {app.lastSyncedRevision || "未知"}
        </p>)}
      </div>
      <div className="asset-row">
        <strong>运行指标 · {data.metrics.source}（{data.metrics.state}）</strong>
        {!data.metrics.items.length && <p className="muted">无可用指标；不推断应用健康。</p>}
        {data.metrics.items.map(item => <p key={item.name} className="muted">
          {metricLabels[item.name] ?? item.name}：{item.value} · 采样 {when(item.sampledAt)}
        </p>)}
      </div>
      <div className="asset-row">
        <strong>最近日志 · {data.logs.source}（{data.logs.state}）</strong>
        {!data.logs.items.length && <p className="muted">未取得实验应用日志。</p>}
        {data.logs.items.slice(0, 10).map((entry, index) => <p key={index} className="muted pre-wrap">
          {when(entry.at)} · {entry.line}
        </p>)}
      </div>
      <div className="asset-row">
        <strong>近期代码及 CI · GitHub</strong>
        {data.github.references.length
          ? data.github.references.map(ref => <p className="muted" key={ref.id}>
              {ref.repository}：提交 {ref.commits.state} / CI {ref.runs.state}，CI 最近结论 {ref.runs.items[0]?.conclusion ?? "未知"}
            </p>)
          : <p className="muted">尚无已登记且可读取的 GitHub 引用。</p>}
      </div>
    </div>}
    {diagnosis && <div className="asset-row" aria-live="polite">
      <strong>AI 分析 · {diagnosis.state} · {diagnosis.model ?? "未配置"}</strong>
      <p className="pre-wrap">{diagnosis.text}</p>
      <p className="muted">{diagnosis.note} · {when(diagnosis.generatedAt)}</p>
    </div>}
  </section>;
}
