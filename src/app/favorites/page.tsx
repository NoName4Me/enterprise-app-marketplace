import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPageUser } from "@/lib/page-user";
import { SiteNav } from "@/app/components/site-nav";
import { Catalog, type CatalogParams } from "@/app/components/catalog";
export const dynamic = "force-dynamic";
export default async function Favorites({ searchParams }: { searchParams: Promise<CatalogParams> }) {
  const user = await getPageUser(await headers());
  if (!user) redirect("/login");
  return <SiteNav user={user} title="我的收藏"><p className="muted">把常用工具留在手边。下架的应用会自动从收藏列表中隐藏。</p><Catalog actor={{ id: user.id }} params={await searchParams} saved /></SiteNav>;
}
