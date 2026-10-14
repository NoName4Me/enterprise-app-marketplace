"use client";

import { useState } from "react";
import type { ArgoOverview, ArgoApplicationObservation } from "@/domain/argocd-model";

function localTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "未提供";
}
function healthLabel(status: ArgoApplicationObservation["health"]): string {
  const map: Record<ArgoApplicationObservation["health"], string> = {
    Healthy: "健康", Progressing: "更新中", Degraded: "异常",
    Suspended: "已暂停", Missing: "资源缺失", Unknown: "未知",
  };
  return map[status];
}
export function ArgoCDLivePanel({ root, registered }: { root: string; registered: number }) {
  const [data, setData] = useState<ArgoOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function refresh() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(root + "/delivery", { cache: "no-store" });
      if (!response.ok) {
        setData(null);
        setError([401, 403, 404].includes(response.status)
          ? "无权查看该应用的运行信息。" : "读取 Argo CD 失败。");
        return;
      }
      setData(await response.json() as ArgoOverview);
    } catch {
      setData(null);
      setError("无法连接门户服务。");
    } finally {
      setLoading(false);
    }
  }
  return <section className="card asset-group" aria-label="GitOps实际部署状态">
    <div className="actions">
      <h3>交付与运行 · Argo CD</h3>
      <button type="button" className="button-secondary" disabled={loading} onClick={() => void refresh()}>
        {loading ? "读取中…" : "读取实际 GitOps 状态"}
      </button>
    </div>
    <p className="muted">
      读取现有 Argo CD Application 的同步、健康及镜像摘要；不是由门户推断的部署成功记录。
      仅只读，不触发同步、发布或回滚。
    </p>
    {!registered && <p className="muted">尚未登记环境。可先登记测试环境，再由运维为 Argo Application 设置应用及环境标识。</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {data && <div className="stack">
      <p className="muted">来源：{data.source} · 获取：{localTime(data.observedAt)}
        {data.dashboardUrl && <> · <a href={data.dashboardUrl} target="_blank" rel="noopener noreferrer">打开 Argo CD</a></>}
      </p>
      {data.state === "NOT_CONNECTED" && <p className="notice">门户尚未配置 Argo CD 只读连接或允许的项目。状态未接入，不代表应用离线。</p>}
      {data.state === "UNKNOWN" && <p className="notice">Argo CD 不可达、拒绝访问或返回无效数据。部署与健康状态未知。</p>}
      {data.state === "OK" && <>
        <p className="muted">Synced 表示 GitOps 配置同步，不等于服务通过业务检查；Healthy 为 Argo CD 报告的资源健康，不等于真实用户流量验证。</p>
        {data.environments.map(env => {
          const applications = data.applications.filter(item => item.environmentId === env.id);
          return <article className="asset-row" key={env.id}>
            <strong>{env.name}（{env.key}）</strong>
            {!applications.length && <p className="muted">未发现带有此应用与环境标识的 Argo CD Application；不能据此断言目标服务未部署。</p>}
            {applications.map(item => <div className="asset-github-section" key={item.project + "/" + item.name}>
              <h4>{item.name} · {item.project}</h4>
              <p className="muted">GitOps 同步：{item.sync} · Argo 资源健康：{healthLabel(item.health)}
                {item.operationPhase && " · 最近操作：" + item.operationPhase}</p>
              <p className="muted">目标 GitOps revision：{item.desiredRevision || "未知"}</p>
              <p className="muted">最近同步历史 revision：{item.lastSyncedRevision || "未知"} · 同步时间：{localTime(item.lastSyncedAt)}</p>
              {item.images.length > 0 && <p className="muted">Argo 汇总镜像：{item.images.join("，")}</p>}
            </div>)}
          </article>;
        })}
        {data.truncated && <p className="notice">匹配的 Application 超过 24 个，仅展示前 24 个。</p>}
      </>}
    </div>}
  </section>;
}
