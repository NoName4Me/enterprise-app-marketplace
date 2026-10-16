"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UiIcon } from "./ui-icon";

type Icon = Parameters<typeof UiIcon>[0]["name"];
const primary: {href:string;label:string;icon:Icon;prefixes?:string[]}[] = [
  {href:"/workbench",label:"工作台",icon:"layers"},
  {href:"/apps",label:"应用",icon:"compass",prefixes:["/apps","/my/apps","/favorites","/discover"]},
  {href:"/requirements",label:"需求",icon:"sparkles"},
  {href:"/operations",label:"运行中心",icon:"boxes"},
];
const admin = [
  {href:"/admin/reviews",label:"应用审核",icon:"shield" as Icon},
  {href:"/admin/apps",label:"应用治理",icon:"boxes" as Icon},
  {href:"/admin/users",label:"账号管理",icon:"users" as Icon},
  {href:"/admin/catalog",label:"市场管理",icon:"layers" as Icon},
];
export function NavLinks({canReview}:{canReview:boolean}) {
  const path=usePathname();
  const active=(href:string,prefixes?:string[])=> href==="/apps"
    ? (prefixes??[]).some(prefix=>path===prefix||path.startsWith(prefix+"/"))
    : path===href||path.startsWith(href+"/");
  return <nav aria-label="主导航" className="site-links">
    <div className="nav-group">
      <p className="nav-caption">工作空间</p>
      {primary.map(item=><Link key={item.href} href={item.href}
        aria-current={active(item.href,item.prefixes)?"page":undefined}>
        <UiIcon name={item.icon}/><span>{item.label}</span>
      </Link>)}
    </div>
    {canReview&&<details className="nav-admin-menu" open={path.startsWith("/admin")}>
      <summary>系统管理</summary>
      <div className="nav-group">
        {admin.map(item=><Link key={item.href} href={item.href}
          aria-current={active(item.href)?"page":undefined}>
          <UiIcon name={item.icon}/><span>{item.label}</span>
        </Link>)}
      </div>
    </details>}
  </nav>;
}
