import Link from "next/link";
import type { ReactNode } from "react";
import type { AccountPermissions } from "@/lib/access";
import { mayCreateApp, mayReviewApp } from "@/lib/access";
import { SignOutButton } from "@/app/apps/sign-out-button";

export function SiteNav({
  user, title, children,
}: {
  user: AccountPermissions & { name: string };
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="shell">
      <header className="site-header">
        <Link className="brand" href="/apps">企业应用市场</Link>
        <nav aria-label="主导航" className="site-links">
          <Link href="/apps">发现应用</Link>
          <Link href="/my/apps">我的应用</Link>
          {mayReviewApp(user) && <Link href="/admin/reviews">应用审核</Link>}
          {mayReviewApp(user) && <Link href="/admin/users">账号管理</Link>}
        </nav>
        <div className="signed-user"><span>{user.name}{mayCreateApp(user) ? " · 发布者" : ""}</span><SignOutButton /></div>
      </header>
      {title && <h1>{title}</h1>}
      {children}
    </div>
  );
}
