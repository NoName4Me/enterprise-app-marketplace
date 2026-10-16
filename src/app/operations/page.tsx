import Link from "next/link";
import { headers } from "next/headers";
import { SiteNav } from "@/app/components/site-nav";
import { getPageUser } from "@/lib/page-user";
import { listOwnedApplications } from "@/domain/app-service";
export const dynamic="force-dynamic";
export default async function Operations() {
  const user=await getPageUser(await headers());
  const apps=await listOwnedApplications({id:user.id});
  return <SiteNav user={user} title="运行中心">
    <div className="page-intro"><h2>从应用出发，定位问题</h2>
      <p className="muted">选择你负责的应用查看真实部署、指标、告警和 AI 分析。没有连接的数据会标为未知，不推断服务健康。</p>
    </div>
    <div className="app-operations-list">
      {apps.map(app=><Link className="card ops-app-row" key={app.id} href={"/my/apps/"+app.id+"?view=operations"}>
        <div><strong>{app.latestName}</strong><p className="muted">{app.listingStatus==="LISTED"?"市场已上架":"市场未上架"} · 运行健康需要从监控实时读取</p></div>
        <span className="tag">查看运行 →</span>
      </Link>)}
      {!apps.length&&<div className="card empty">你还没有负责的应用。运维资料仅向相应维护者开放。</div>}
    </div>
  </SiteNav>;
}
