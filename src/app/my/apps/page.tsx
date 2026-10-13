import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { listOwnedApplications } from "@/domain/app-service";
import { getPageUser } from "@/lib/page-user";
import { mayCreateApp } from "@/lib/access";
import { statusName } from "@/lib/marketplace-labels";

export const dynamic = "force-dynamic";
export default async function MyApps() {
  const current = await getPageUser(await headers());
  if (!current) redirect("/login");
  const apps = await listOwnedApplications({ id: current.id });
  return <SiteNav user={current} title="我的应用">
    <div className="actions">
      <p className="muted">管理已登记的应用和审核申请。</p>
      {mayCreateApp(current) && <Link className="button" href="/my/apps/new">登记 Web 应用</Link>}
    </div>
    {!mayCreateApp(current) && <p className="notice">当前账号没有应用创建权限。如需发布，请联系管理员开通。</p>}
    {apps.length === 0 ? <div className="empty">还没有登记过应用。</div> :
      <div className="grid">
        {apps.map(app => <Link key={app.id} href={`/my/apps/${app.id}`} className="card app-card">
          <h2>{app.latestName}</h2>
          <span className={`tag status-${app.latestStatus.toLowerCase()}`}>{statusName(app.latestStatus)}</span>
          <p>{app.listingStatus === "LISTED" ? "市场已上架" : "市场未上架"} · 申请版本 #{app.sequence}</p>
        </Link>)}
      </div>}
  </SiteNav>;
}
