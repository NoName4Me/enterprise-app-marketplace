import Link from "next/link";
import type { ReactNode } from "react";
import type { AccountPermissions } from "@/lib/access";
import { mayCreateApp, mayReviewApp } from "@/lib/access";
import { SignOutButton } from "@/app/apps/sign-out-button";
import { NavLinks } from "./nav-links";
import { UiIcon } from "./ui-icon";

export function SiteNav({
  user, title, children,
}: {
  user: AccountPermissions & { name: string };
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="site-sidebar">
        <Link className="brand" href="/apps"><span className="brand-mark"><UiIcon name="boxes" /></span><span>企业应用平台</span></Link>
        <div className="sidebar-navigation">
          <NavLinks canReview={mayReviewApp(user)} />
        </div>
        <div className="sidebar-footer"><Link href="/account/security">账号与安全</Link></div>
        <div className="signed-user">
          <span className="user-avatar" aria-hidden="true">{user.name.slice(0, 1)}</span>
          <div className="user-identity"><strong>{user.name}</strong><span>{mayReviewApp(user) ? "管理员" : mayCreateApp(user) ? "应用发布者" : "员工"}</span></div>
          <SignOutButton />
        </div>
      </aside>
      <div className="workspace">
        <header className="site-header"><span>工作空间 <span className="breadcrumb-divider">/</span> {title || "应用市场"}</span><span className="workspace-label">需求 · 交付 · 运行</span></header>
        <main className="workspace-content" id="main-content">
          {title && <div className="page-heading"><p className="eyebrow">工作空间</p><h1>{title}</h1></div>}
          {children}
        </main>
      </div>
    </div>
  );
}
