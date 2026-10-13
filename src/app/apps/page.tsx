import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listPublished } from "@/domain/app-service";
import { SiteNav } from "@/app/components/site-nav";
import { categoryNames } from "@/lib/marketplace-labels";
import { getActiveUser } from "@/lib/active-user";

export const dynamic = "force-dynamic";
export default async function Apps({ searchParams }: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getActiveUser(await headers());
  if (!user) redirect("/login");
  const q = (await searchParams).q ?? "";
  // Also protect the server-rendered page against oversized query terms.
  const keyword = q.slice(0, 120);
  const apps = await listPublished({ id: user.id }, keyword);
  return <SiteNav user={user}>
    <div className="hero">
      <p className="eyebrow">Enterprise App Marketplace</p>
      <h1>发现适合工作的内部应用</h1>
      <p>查找经过平台审核的 Web 应用，访问入口由应用负责人提供。</p>
      <form className="search" action="/apps" method="GET" role="search">
        <label className="sr-only" htmlFor="market-search">搜索应用</label>
        <input id="market-search" type="search" name="q"
          placeholder="按应用名称搜索…" defaultValue={keyword} maxLength={120}/>
        <button type="submit">搜索</button>
      </form>
    </div>
    <div className="actions">
      <h2>{keyword ? `搜索“${keyword}”的结果` : "全部已上架应用"}</h2>
      {keyword && <Link href="/apps">清除搜索</Link>}
    </div>
    {apps.length === 0 ? <div className="empty">暂时没有符合条件的已上架应用。</div> :
      <div className="grid">
        {apps.map(app => <Link className="card app-card" key={app.id} href={`/apps/${app.id}`}>
          <div className="app-icon" aria-hidden="true">{app.name.slice(0, 1)}</div>
          <h3>{app.name}</h3>
          <p>{app.summary}</p>
          <span className="tag">{categoryNames[app.category] ?? app.category}</span>
        </Link>)}
      </div>}
  </SiteNav>;
}
