import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { getPageUser } from "@/lib/page-user";
import { getRequirement } from "@/domain/requirement-service";
import { AppError } from "@/domain/app-errors";
import { RequirementActions } from "./requirement-actions";
import { CodingAgentPanel } from "./coding-agent-panel";
export const dynamic="force-dynamic";
const states:Record<string,string>={OPEN:"待处理",IN_PROGRESS:"处理中",DONE:"已完成",REJECTED:"不采纳"};
export default async function RequirementDetail({params}:{params:Promise<{id:string}>}){
  const current=await getPageUser(await headers());const id=(await params).id;
  let item:Awaited<ReturnType<typeof getRequirement>>;
  try{item=await getRequirement({id:current.id},id)}catch(e){if(e instanceof AppError&&e.status===404)notFound();throw e}
  return <SiteNav user={current} title={item.title}>
    <p><Link href="/requirements">← 返回需求中心</Link></p>
    <section className="card"><p className="eyebrow">{item.type} · {states[item.status]}</p>
      <h2>{item.title}</h2><p className="pre-wrap">{item.description}</p>
      <p className="muted">提交人：{item.creatorName} · {new Date(item.createdAt).toLocaleString("zh-CN")}</p>
      {item.appId&&<p><Link href={"/apps/"+item.appId}>{item.appName??"关联应用"}</Link></p>}
      {item.githubIssueUrl&&<p><a href={item.githubIssueUrl} target="_blank" rel="noopener noreferrer">历史 GitHub Issue（仅供追溯）</a></p>}
      {item.githubPrUrl&&<p><a href={item.githubPrUrl} target="_blank" rel="noopener noreferrer">GitHub PR</a></p>}
      {item.handlerName&&<p className="muted">当前登记处理人：{item.handlerName}</p>}
      {item.resolution&&<p className="notice">人工处理结论：{item.resolution}</p>}
    </section>
    <RequirementActions requirementId={id} canManage={item.canManage} initial={item}/>
    <section className="card"><h3>讨论记录</h3>
      {!item.comments.length&&<p className="muted">暂无讨论。</p>}
      {item.comments.map(c=><article key={c.id} className="asset-row"><strong>{c.authorName}</strong>
        <p className="muted">{new Date(c.at).toLocaleString("zh-CN")}</p><p className="pre-wrap">{c.body}</p></article>)}
    </section>
    {item.canManage&&item.appId&&<CodingAgentPanel requirementId={id} appId={item.appId}/>}
  </SiteNav>;
}
