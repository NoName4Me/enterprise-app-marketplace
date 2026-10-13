import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { getPendingReview } from "@/domain/app-service";
import { AppError } from "@/domain/app-errors";
import { getActiveUser } from "@/lib/active-user";
import { mayReviewApp } from "@/lib/access";
import { categoryNames } from "@/lib/marketplace-labels";
import { ReviewControls } from "../review-controls";

export const dynamic = "force-dynamic";
function RevisionDetails({ title, value }: {
  title: string;
  value: { name: string; summary: string; description: string;
    category: string; targetUrl: string; iconRef: string | null };
}) {
  return <section className="card">
    <h2>{title}</h2>
    <dl className="fields">
      <dt>名称</dt><dd>{value.name}</dd>
      <dt>简介</dt><dd>{value.summary}</dd>
      <dt>分类</dt><dd>{categoryNames[value.category] ?? value.category}</dd>
      <dt>详细介绍</dt><dd className="pre-wrap">{value.description || "暂无"}</dd>
      <dt>访问地址</dt><dd className="break-all">{value.targetUrl}</dd>
      <dt>图标地址</dt><dd className="break-all">{value.iconRef ?? "暂无"}</dd>
    </dl>
  </section>;
}
export default async function ReviewDetails({
  params,
}: { params: Promise<{ id: string }> }) {
  const user = await getActiveUser(await headers());
  if (!user) redirect("/login");
  if (!mayReviewApp(user)) redirect("/apps");
  let revision: Awaited<ReturnType<typeof getPendingReview>>;
  try { revision = await getPendingReview({ id: user.id }, (await params).id); }
  catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return <SiteNav user={user} title="审核应用申请">
    <p><Link href="/admin/reviews">← 返回待审列表</Link></p>
    <p className="notice">版本 #{revision.sequence} · 申请人 ID：{revision.createdBy}</p>
    <div className="two-columns">
      <RevisionDetails title="本次申请（待审批）" value={revision}/>
      {revision.previous ?
        <RevisionDetails title="当前已上架版本（对比）" value={revision.previous}/> :
        <section className="card"><h2>首次上架</h2><p>此应用尚无公开版本。</p></section>}
    </div>
    {revision.createdBy === user.id ?
      <p className="error">不能审核自己提交的申请，请由另一位管理员处理。</p> :
      <ReviewControls revisionId={revision.id}/>}
  </SiteNav>;
}
