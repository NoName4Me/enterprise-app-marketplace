import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { getActiveUser } from "@/lib/active-user";
import { mayReviewApp } from "@/lib/access";
import { UserManagement } from "./user-management";

export const dynamic = "force-dynamic";
export default async function AdminUsersPage() {
  const me = await getActiveUser(await headers());
  if (!me) redirect("/login");
  if (!mayReviewApp(me)) redirect("/apps");

  const users = await db.select({
    id: user.id, name: user.name, email: user.email,
    role: user.role, banned: user.banned, canCreateApp: user.canCreateApp,
  }).from(user).limit(100);
  return <main><h1>员工管理</h1><UserManagement users={users} /></main>;
}
