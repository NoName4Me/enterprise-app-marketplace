import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { getPageUser } from "@/lib/page-user";
import { mayCreateApp } from "@/lib/access";
import { ApplicationForm } from "../application-form";

export const dynamic = "force-dynamic";
export default async function NewApplication() {
  const current = await getPageUser(await headers());
  if (!current) redirect("/login");
  if (!mayCreateApp(current)) redirect("/my/apps");
  return <SiteNav user={current} title="登记新应用">
    <p className="muted">这里只登记已经存在的 Web 应用。审核通过前不会出现在应用市场。</p>
    <ApplicationForm mode="create" />
  </SiteNav>;
}
