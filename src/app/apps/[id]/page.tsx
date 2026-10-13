import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { getPublished } from "@/domain/app-service";
import { AppError } from "@/domain/app-errors";
import { getActiveUser } from "@/lib/active-user";
import { categoryNames } from "@/lib/marketplace-labels";

export const dynamic = "force-dynamic";
export default async function AppDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await getActiveUser(await headers());
  if (!user) redirect("/login");
  let app: Awaited<ReturnType<typeof getPublished>>;
  try { app = await getPublished({ id: user.id }, (await params).id); }
  catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  return <SiteNav user={user}>
    <p><Link href="/apps">← 返回应用市场</Link></p>
    <div className="card detail-card">
      <div className="app-icon large" aria-hidden="true">{app.name.slice(0, 1)}</div>
      <div>
        <p className="eyebrow">已审核上架 · {categoryNames[app.category] ?? app.category}</p>
        <h1>{app.name}</h1>
        <p className="lead">{app.summary}</p>
        <a className="button" href={app.targetUrl} target="_blank" rel="noopener noreferrer">
          打开 Web 应用 ↗
        </a>
        <p className="muted">目标应用可能需要单独登录；平台上架不代表拥有目标系统的访问权限。</p>
      </div>
    </div>
    <section className="card content">
      <h2>应用介绍</h2>
      <p className="pre-wrap">{app.description || "发布者尚未填写详细介绍。"}</p>
    </section>
  </SiteNav>;
}
