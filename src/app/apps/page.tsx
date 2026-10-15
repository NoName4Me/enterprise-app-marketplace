import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { Catalog, type CatalogParams } from "@/app/components/catalog";
import { getPageUser } from "@/lib/page-user";

export const dynamic = "force-dynamic";
export default async function Apps({ searchParams }: { searchParams: Promise<CatalogParams> }) {
  const user = await getPageUser(await headers());
  if (!user) redirect("/login");
  return <SiteNav user={user}>
    <nav className="app-index-tabs" aria-label="应用分区">
      <Link href="/apps" aria-current="page">应用市场</Link>
      <Link href="/my/apps">我管理的</Link>
      <Link href="/favorites">已收藏</Link>
      <Link href="/discover">AI 场景搜索</Link>
    </nav>
    <Catalog actor={{ id: user.id }} params={await searchParams} />
  </SiteNav>;
}
