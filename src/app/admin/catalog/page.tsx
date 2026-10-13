import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { applications, appRevisions, catalogEvents, user as users } from "@/db/schema";
import { getPageUser } from "@/lib/page-user";
import { authorizeActor } from "@/domain/actor";
import { mayReviewApp } from "@/lib/access";
import { SiteNav } from "@/app/components/site-nav";
import { CatalogManagement } from "./catalog-management";
export const dynamic = "force-dynamic";
export default async function AdminCatalog() {
  const user = await getPageUser(await headers());
  if (!user) redirect("/login");
  if (!mayReviewApp(user)) redirect("/apps");
  await authorizeActor({ id: user.id }, "review");
  const apps = await db.select({ id: applications.id, name: appRevisions.name, listingStatus: applications.listingStatus, featured: applications.featured })
    .from(applications).innerJoin(appRevisions, and(eq(applications.publishedRevisionId, appRevisions.id), eq(appRevisions.appId, applications.id)))
    .where(eq(appRevisions.status, "APPROVED")).orderBy(desc(appRevisions.reviewedAt)).limit(100);
  const events = await db.select({ id: catalogEvents.id, action: catalogEvents.action, reason: catalogEvents.reason,
    occurredAt: catalogEvents.occurredAt, actor: users.name, appName: appRevisions.name }).from(catalogEvents)
    .innerJoin(users, eq(users.id, catalogEvents.actorUserId)).innerJoin(applications, eq(applications.id, catalogEvents.appId))
    .innerJoin(appRevisions, eq(appRevisions.id, applications.publishedRevisionId))
    .orderBy(desc(catalogEvents.occurredAt)).limit(30);
  const names: Record<string, string> = { FEATURED: "设为推荐", UNFEATURED: "取消推荐", UNLISTED: "下架", RELISTED: "恢复上架", FEEDBACK_HIDDEN: "隐藏评价", DISCUSSION_HIDDEN: "隐藏讨论" };
  return <SiteNav user={user} title="市场管理"><p className="muted">维护编辑推荐与上架状态。所有变更记录操作人、时间和原因。</p><CatalogManagement apps={apps} />
    <section className="card content"><h2>最近的市场操作</h2><div className="stack">{events.map(event => <article key={event.id} className="audit-row"><strong>{event.appName} · {names[event.action] ?? event.action}</strong><p className="muted">{event.actor} · {event.occurredAt.toLocaleString("zh-CN")}</p>{event.reason && <p>{event.reason}</p>}</article>)}{!events.length && <p className="muted">暂无操作记录。</p>}</div></section>
  </SiteNav>;
}
