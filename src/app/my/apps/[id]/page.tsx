import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { getOwnedApplication } from "@/domain/app-service";
import { AppError } from "@/domain/app-errors";
import { getPageUser } from "@/lib/page-user";
import { mayCreateApp } from "@/lib/access";
import { categoryNames, statusName } from "@/lib/marketplace-labels";
import { ApplicationForm } from "../application-form";
import { RevisionAction } from "../revision-action";

export const dynamic = "force-dynamic";
export default async function ManagedApplication({
  params,
}: { params: Promise<{ id: string }> }) {
  const current = await getPageUser(await headers());
  if (!current) redirect("/login");
  const id = (await params).id;
  let data: Awaited<ReturnType<typeof getOwnedApplication>>;
  try { data = await getOwnedApplication({ id: current.id }, id); }
  catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  const latest = data.revisions[0];
  const canWrite = mayCreateApp(current);
  return <SiteNav user={current} title={latest?.name || "应用详情"}>
    <p><Link href="/my/apps">← 返回我的应用</Link></p>
    <p className="notice">市场状态：{data.listingStatus === "LISTED" ? "已上架" : "未上架"}；最新申请：{statusName(latest.status)}</p>
    {data.listingStatus === "LISTED" && <p><Link href={`/apps/${id}`}>查看应用市场中的当前版本</Link></p>}
    {latest.status === "DRAFT" && canWrite && <ApplicationForm mode="edit" appId={id} initial={latest}/>}
    {latest.status === "DRAFT" && !canWrite && <p className="notice">创建权限已撤销，只能查看历史，不能修改或提交。</p>}
    {latest.status === "PENDING" && <p className="notice">审核中：本版本不可修改，已上架应用仍展示原版本。</p>}
    {(latest.status === "REJECTED" || latest.status === "APPROVED") && canWrite &&
      <RevisionAction appId={id} />}
    <h2>申请历史</h2>
    <div className="stack">
      {data.revisions.map(revision => <section key={revision.id} className="card">
        <div className="actions">
          <strong>第 {revision.sequence} 版：{revision.name || "未命名应用"}</strong>
          <span className={`tag status-${revision.status.toLowerCase()}`}>{statusName(revision.status)}</span>
        </div>
        <p>{revision.summary || "无简介"} · {categoryNames[revision.category] ?? revision.category}</p>
        {revision.targetUrl && <p className="muted">登记地址：{revision.targetUrl}</p>}
        {revision.rejectionReason && <p className="error">驳回原因：{revision.rejectionReason}</p>}
      </section>)}
    </div>
  </SiteNav>;
}
