import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { getPageUser } from "@/lib/page-user";
import { mayReviewApp } from "@/lib/access";
import { lifecycleName, statusName } from "@/lib/marketplace-labels";
import { listGovernedApplications } from "@/domain/asset-service";
export const dynamic = "force-dynamic";
export default async function GovernedApps() {
  const current = await getPageUser(await headers());
  if (!current) redirect("/login");
  if (!mayReviewApp(current)) redirect("/apps");
  const apps = await listGovernedApplications({ id: current.id });
  return <SiteNav user={current} title="应用治理"><p className="muted">查看私有资产、维护责任和生命周期。市场审核与上架仍使用原有入口。</p><div className="grid">{apps.map(app => <Link className="card app-card" href={`/admin/apps/${app.id}`} key={app.id}><h2>{app.name}</h2><p>负责人：{app.ownerName}</p><p>市场：{app.listingStatus === "LISTED" ? "已上架" : "未上架"} · 审核：{statusName(app.revisionStatus)}</p><span className="tag">生命周期：{lifecycleName(app.lifecycleStatus)}</span></Link>)}</div>{!apps.length && <p className="empty">暂无应用。</p>}</SiteNav>;
}
