import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/active-user";
import { SiteNav } from "@/app/components/site-nav";
import { PasswordForm } from "./password-form";
export const dynamic = "force-dynamic";
export default async function AccountSecurity() {
  const user = await getAuthenticatedUser(await headers());
  if (!user) redirect("/login");
  return <SiteNav user={user} title="账号安全"><PasswordForm required={user.mustChangePassword}/><section className="card security-card"><h2>忘记密码或无法登录</h2><p className="muted">联系平台管理员核实身份。管理员会提供一个 15 分钟内有效、仅可使用一次的重置链接；生成新链接后旧链接和旧会话失效。</p></section></SiteNav>;
}
