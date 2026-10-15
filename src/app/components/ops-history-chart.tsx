import type {ReadyPodHistory} from "@/domain/ops-series";
export function OpsHistoryChart({history}:{history:ReadyPodHistory}){
  if(!history.series.length)return <section className="card">
    <h3>过去一小时 · 就绪 Pod 趋势</h3>
    <p className="muted">未确认此应用的专属部署环境，无法显示可靠的时间序列。</p>
  </section>;
  return <section className="card"><div className="section-title">
    <h3>过去一小时 · 就绪 Pod 趋势</h3><span className="tag">Prometheus</span>
  </div>
    <p className="muted">按已验证的应用环境隔离。就绪 Pod 数是基础设施指标，不代表业务请求一定成功。</p>
    <div className="ops-chart-list">{history.series.map(series=>{
      const max=Math.max(1,...series.points.map(point=>point.value));
      const points=series.points.map((point,index)=>{
        const x=20+(index/Math.max(1,series.points.length-1))*600;
        const y=130-(point.value/max)*110;
        return x.toFixed(1)+","+y.toFixed(1);
      }).join(" ");
      return <article key={series.namespace} className="ops-chart">
        <div className="section-title"><strong>{series.environment}</strong>
          <small>{series.state==="OK"?"已采集":series.state==="NOT_CONNECTED"?"未接入":"暂无可信采样"}</small></div>
        {series.points.length>1?<svg role="img"
          aria-label={series.environment+"过去一小时就绪 Pod 数趋势"}
          viewBox="0 0 640 150" preserveAspectRatio="none" className="ops-chart-svg">
          <line x1="20" y1="130" x2="620" y2="130" stroke="currentColor" opacity=".18"/>
          <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="3"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>:<div className="ops-chart-no-data">采样不足，暂不生成趋势图</div>}
        {series.points.length>0&&<p className="muted">
          最近采样：{series.points.at(-1)?.value} 个就绪 Pod · {new Date(series.points.at(-1)!.at).toLocaleTimeString("zh-CN")}
        </p>}
      </article>;
    })}</div>
  </section>;
}
