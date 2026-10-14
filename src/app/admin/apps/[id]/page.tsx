import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { AssetWorkspace } from "@/app/components/asset-workspace";
import { getPageUser } from "@/lib/page-user";
import { mayReviewApp } from "@/lib/access";
import { getAssets } from "@/domain/asset-service";
import { AppError } from "@/domain/app-errors";
export const dynamic = "force-dynamic";
export default async function GovernedApp({ params }: { params: Promise<{ id: string }> }) {
  const current = await getPageUser(await headers());
  if (!current) redirect("/login");
  if (!mayReviewApp(current)) redirect("/apps");
  const id = (await params).id;
  let name: string;
  try { name = (await getAssets({ id: current.id }, id, true)).name; }
  catch (error) { if (error instanceof AppError && error.status === 404) notFound(); throw error; }
  return <SiteNav user={current} title={name}><p><Link href="/admin/apps">← 返回应用治理</Link> · <Link href="/admin/catalog">市场上下架管理</Link></p><AssetWorkspace actor={{ id: current.id }} appId={id} admin canWrite={false} /></SiteNav>;
}
