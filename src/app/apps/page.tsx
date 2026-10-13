import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { Catalog, type CatalogParams } from "@/app/components/catalog";
import { getActiveUser } from "@/lib/active-user";

export const dynamic = "force-dynamic";
export default async function Apps({ searchParams }: { searchParams: Promise<CatalogParams> }) {
  const user = await getActiveUser(await headers());
  if (!user) redirect("/login");
  return <SiteNav user={user}><Catalog actor={{ id: user.id }} params={await searchParams} /></SiteNav>;
}
