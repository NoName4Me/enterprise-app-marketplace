import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { desc } from "drizzle-orm";
import { securityEvents, user } from "@/db/schema";
import { getPageUser } from "@/lib/page-user";
import { mayReviewApp } from "@/lib/access";
import { SiteNav } from "@/app/components/site-nav";
import { UserManagement } from "./user-management";

export const dynamic = "force-dynamic";
export default async function AdminUsersPage() {
  const me = await getPageUser(await headers());
  if (!me) redirect("/login");
  if (!mayReviewApp(me)) redirect("/apps");
  const users = await db.select({
    id: user.id, name: user.name, email: user.email,
    role: user.role, banned: user.banned, canCreateApp: user.canCreateApp, mustChangePassword: user.mustChangePassword,
  }).from(user).limit(100);
  const events = await db.select().from(securityEvents).orderBy(desc(securityEvents.occurredAt)).limit(30);
  const names: Record<string, string> = { LOGIN_SUCCEEDED: "登录成功", LOGIN_FAILED: "登录失败", SIGNED_OUT: "退出登录", ACCOUNT_CREATED: "开通账号", ACCOUNT_BANNED: "停用账号", ACCOUNT_RESTORED: "恢复账号", ROLE_CHANGED: "变更角色", ACCOUNT_REMOVED: "删除账号", ACCOUNT_UPDATED: "更新账号", PROFILE_UPDATED: "更新个人资料", PASSWORD_CHANGED: "修改密码", PASSWORD_RESET_ISSUED: "生成重置链接", PASSWORD_RESET_COMPLETED: "完成密码重置", CREATE_PERMISSION_CHANGED: "变更应用创建权", SESSIONS_REVOKED: "撤销全部会话", SESSION_REVOKED: "撤销会话" };
  return <SiteNav user={me} title="账号管理"><UserManagement users={users} currentUserId={me.id}/><section className="card"><h2>最近的账号安全记录</h2>{events.map(event => <article className="audit-row" key={event.id}><strong>{event.action.endsWith("_REJECTED") ? `${names[event.action.replace(/_REJECTED$/, "")] ?? "敏感操作"}（失败）` : names[event.action] ?? event.action}</strong><p className="muted">{event.occurredAt.toLocaleString("zh-CN")} · 操作人：{users.find(u => u.id === event.actorUserId)?.name ?? "未登录或系统"} · 目标：{users.find(u => u.id === event.targetUserId)?.name ?? "无或已删除"}</p>{event.reason && <p>{event.reason}</p>}</article>)}</section></SiteNav>;
}
