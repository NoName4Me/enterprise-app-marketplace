import Link from "next/link";
import { headers } from "next/headers";
import { SiteNav } from "@/app/components/site-nav";
import { getPageUser } from "@/lib/page-user";
import { listRequirements } from "@/domain/requirement-service";
import { RequirementCreate } from "./requirement-create";
export const dynamic = "force-dynamic";
const names:Record<string,string>={NEW_APP:"新应用",FEATURE:"新功能",BUG:"缺陷",IMPROVEMENT:"改进"};
const states:Record<string,string>={OPEN:"待处理",IN_PROGRESS:"处理中",DONE:"已完成",REJECTED:"不采纳"};
export default async function Requirements({searchParams}:{searchParams:Promise<{appId?:string}>}) {
  const current=await getPageUser(await headers());
  const appId=(await searchParams).appId??"";
  const rows=await listRequirements({id:current.id});
  return <SiteNav user={current} title="需求中心">
    <p className="muted">从员工问题到维护者处理，研发实现仍在 GitHub。P5 可从关联需求启动现成 Coding Agent。</p>
    <RequirementCreate appId={appId} />
    <h2>最近需求</h2>
    <div className="stack">{rows.map(row=><Link key={row.id} className="card" href={"/requirements/"+row.id}>
      <div className="actions"><strong>{row.title}</strong><span className="tag">{states[row.status]}</span></div>
      <p className="muted">{names[row.type]} · {row.appName??"新应用"} · {new Date(row.createdAt).toLocaleDateString("zh-CN")}</p>
    </Link>)}
    {!rows.length && <p className="empty">暂无需求。</p>}</div>
  </SiteNav>;
}
