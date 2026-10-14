"use client";

import { useState, type ReactNode } from "react";
import type { GithubReference, GithubCommit, GithubPull, GithubRun } from "@/domain/github-overview";

type Section<T> = { state: "OK" | "NOT_CONNECTED" | "UNKNOWN"; items: T[] };
type Overview = {
  source: "GitHub REST API";
  fetchedAt: string;
  references: GithubReference[];
  truncated: boolean;
  deploymentStatus: "NOT_CONNECTED";
  healthStatus: "NOT_CONNECTED";
};
function stateLabel(state: Section<unknown>["state"]) {
  return state === "OK" ? "已连接" : state === "NOT_CONNECTED" ? "无法访问/未连接" : "状态未知";
}
function when(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "未知时间";
}
function LinkOrText({ href, children }: { href: string; children: ReactNode }) {
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
}
function Items<T extends { url: string }>({
  title, section, content,
}: { title: string; section: Section<T>; content: (item: T) => ReactNode }) {
  return <div className="asset-github-section">
    <h4>{title} · {stateLabel(section.state)}</h4>
    {section.state === "OK" && !section.items.length && <p className="muted">暂无记录。</p>}
    {section.state !== "OK" && <p className="muted">GitHub 未返回可用数据，不能据此判断运行状况。</p>}
    {section.items.map((entry, index) =>
      <p key={entry.url || index} className="muted">
        <LinkOrText href={entry.url}>{content(entry)}</LinkOrText>
      </p>
    )}
  </div>;
}
export function GithubLivePanel({ root, registered }: { root: string; registered: number }) {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(root + "/github", { cache: "no-store" });
      if (!response.ok) {
        setData(null);
        setError(response.status === 401 || response.status === 403 || response.status === 404
          ? "无权读取应用的私有研发信息，请检查登录及资产权限。"
          : "读取 GitHub 信息失败，请稍后重试。");
        return;
      }
      setData(await response.json() as Overview);
    } catch {
      setData(null); setError("网络错误，无法读取 GitHub。");
    } finally { setBusy(false); }
  }
  return <section className="card asset-group" aria-label="GitHub真实信息">
    <div className="actions"><h3>GitHub 研发信息</h3>
      <button className="button-secondary" type="button" disabled={busy || !registered} onClick={() => void refresh()}>
        {busy ? "读取中…" : data ? "重新读取 GitHub" : "读取 GitHub 最新信息"}
      </button>
    </div>
    <p className="muted">仅在点击时按登记的引用读取 GitHub 数据。提交、PR、Actions 是 GitHub 事实，<strong>不是部署或服务健康结果</strong>。</p>
    {!registered && <p className="muted">当前没有已登记的 GitHub 引用，先在上方添加仓库或流水线。</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {data && <>
      <p className="muted">来源：{data.source} · 最近读取：{when(data.fetchedAt)}
        {data.truncated ? " · 引用较多，仅展示前 8 条（最多 4 个仓库）" : ""}</p>
      <p className="notice">实际部署：未接入 · 运行健康：未接入。GitHub 数据可能因凭据、访问范围或 API 限额而暂不可用。</p>
      {!data.references.length && <p className="muted">没有可查询的有效未归档引用。</p>}
      {data.references.map(ref => <article key={ref.id} className="asset-row">
        <strong>{ref.componentName} · {ref.repository}{ref.workflowId ? " · Workflow #" + ref.workflowId : ""}</strong>
        {ref.environmentName && <p className="muted">关联环境：{ref.environmentName}（仅登记关联，不代表实际部署）</p>}
        <div className="asset-github-grid">
          <Items<GithubCommit> title="最新提交" section={ref.commits}
            content={item => <>{item.sha.slice(0, 7)} · {item.title || "无标题"} · {when(item.at)}</>} />
          <Items<GithubPull> title="最近 PR" section={ref.pulls}
            content={item => <>#{item.number} · {item.title} · {item.state} · {when(item.at)}</>} />
          <Items<GithubRun> title={ref.kind === "WORKFLOW" ? "该 Workflow 运行" : "Actions 运行"}
            section={ref.runs}
            content={item => <>{item.title || "#" + item.id} · {item.conclusion ?? item.status} · {when(item.at)}</>} />
        </div>
      </article>)}
    </>}
  </section>;
}
