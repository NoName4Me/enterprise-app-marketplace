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
  return <SiteNav user={current} title="接入应用">
    <p className="muted">选择接入已有应用，或连接 GitHub 仓库创建托管应用。两种应用都不需要手动填写组件与环境。</p>
    <ApplicationForm mode="create" />
  </SiteNav>;
}
