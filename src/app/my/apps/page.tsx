import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { listOwnedApplications } from "@/domain/app-service";
import { getPageUser } from "@/lib/page-user";
import { mayCreateApp } from "@/lib/access";
import { lifecycleName, statusName } from "@/lib/marketplace-labels";

export const dynamic = "force-dynamic";
export default async function MyApps() {
  const current = await getPageUser(await headers());
  if (!current) redirect("/login");
  const apps = await listOwnedApplications({ id: current.id });
  return <SiteNav user={current} title="我的应用">
    <nav className="app-index-tabs" aria-label="应用分区">
      <Link href="/apps">应用市场</Link>
      <Link href="/my/apps" aria-current="page">我管理的</Link>
      <Link href="/favorites">已收藏</Link>
    </nav>
    <div className="actions">
      <p className="muted">管理你负责的应用，查看交付、发布与运行状态。</p>
      {mayCreateApp(current) && <Link className="button" href="/my/apps/new">接入应用</Link>}
    </div>
    {!mayCreateApp(current) && <p className="notice">当前账号没有应用创建权限。如需发布，请联系管理员开通。</p>}
    {apps.length === 0 ? <div className="empty">还没有登记过应用。</div> :
      <div className="grid">
        {apps.map(app => <Link key={app.id} href={`/my/apps/${app.id}`} className="card app-card">
          <h2>{app.latestName}</h2><p className="muted">{app.sourceKind==="HOSTED"?"GitHub 托管":"外部链接"}</p>
          <span className={`tag status-${app.latestStatus.toLowerCase()}`}>{statusName(app.latestStatus)}</span>
          <p>生命周期：{lifecycleName(app.lifecycleStatus)}</p>
          <p>{app.listingStatus === "LISTED" ? "市场已上架" : "市场未上架"} · 申请版本 #{app.sequence}</p>
        </Link>)}
      </div>}
  </SiteNav>;
}
