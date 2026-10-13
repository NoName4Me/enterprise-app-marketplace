import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { listPendingReviews } from "@/domain/app-service";
import { getActiveUser } from "@/lib/active-user";
import { mayReviewApp } from "@/lib/access";

export const dynamic = "force-dynamic";
export default async function ReviewQueue() {
  const user = await getActiveUser(await headers());
  if (!user) redirect("/login");
  if (!mayReviewApp(user)) redirect("/apps");
  const pending = await listPendingReviews({ id: user.id });
  return <SiteNav user={user} title="应用审核">
    <p className="muted">审核应用登记内容。已有上架版本在更新审核期间仍保持公开。</p>
    {pending.length === 0 ? <div className="empty">暂无待审核申请。</div> :
      <div className="stack">
        {pending.map(item => <Link className="card app-card" key={item.revisionId}
          href={`/admin/reviews/${item.revisionId}`}>
          <h2>{item.name}</h2>
          <p>{item.summary}</p>
          <div className="actions">
            <span className="tag status-pending">第 {item.sequence} 版 · 待审核</span>
            <span className="muted">提交时间：{item.submittedAt?.toLocaleString("zh-CN") ?? "未知"}</span>
          </div>
        </Link>)}
      </div>}
  </SiteNav>;
}
