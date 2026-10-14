"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UiIcon } from "./ui-icon";

export function NavLinks({ canReview }: { canReview: boolean }) {
  const pathname = usePathname();
  const links = [
    { href: "/apps", label: "发现应用", icon: "compass" as const },
    { href: "/my/apps", label: "我的应用", icon: "layers" as const },
    { href: "/favorites", label: "我的收藏", icon: "bookmark" as const },
    { href: "/discover", label: "场景找应用", icon: "sparkles" as const },
    { href: "/account/security", label: "账号安全", icon: "shield" as const },
    ...(canReview ? [
      { href: "/admin/apps", label: "应用治理", icon: "boxes" as const },
      { href: "/admin/reviews", label: "应用审核", icon: "shield" as const },
      { href: "/admin/users", label: "账号管理", icon: "users" as const },
      { href: "/admin/catalog", label: "市场管理", icon: "layers" as const },
    ] : []),
  ];
  return <nav aria-label="主导航" className="site-links">
    {links.map(link => <Link key={link.href} href={link.href}
      aria-current={pathname === link.href || pathname.startsWith(`${link.href}/`) ? "page" : undefined}>
      <UiIcon name={link.icon} /><span>{link.label}</span>
    </Link>)}
  </nav>;
}
