import Link from "next/link";
import { headers } from "next/headers";
import { SiteNav } from "@/app/components/site-nav";
import { getPageUser } from "@/lib/page-user";
import { listOwnedApplications } from "@/domain/app-service";
import { listRequirements } from "@/domain/requirement-service";
import { mayCreateApp } from "@/lib/access";
export const dynamic="force-dynamic";
export default async function Workbench() {
  const user=await getPageUser(await headers());
  const [apps,requirements]=await Promise.all([
    listOwnedApplications({id:user.id}),listRequirements({id:user.id}),
  ]);
  const open= requirements.filter(item=>item.status==="OPEN"||item.status==="IN_PROGRESS");
  return <SiteNav user={user} title="工作台">
    <section className="workbench-hero">
      <p className="eyebrow">你的工作空间</p>
      <h2>从一个需求，到一个可持续运行的应用</h2>
      <p>从这里找到已有应用、提交改进需求，或查看自己负责的应用和交付进度。</p>
      <div className="actions">
        <Link className="button" href="/apps">发现应用</Link>
        <Link className="button button-secondary" href="/requirements">提出需求</Link>
        {mayCreateApp(user)&&<Link className="button button-secondary" href="/my/apps/new">接入应用</Link>}
      </div>
    </section>
    <div className="overview-metrics">
      <Link className="card metric-card" href="/my/apps"><span>我管理的应用</span><strong>{apps.length}</strong><small>查看版本和运行情况 →</small></Link>
      <Link className="card metric-card" href="/requirements"><span>进行中的需求</span><strong>{open.length}</strong><small>查看沟通和交付进度 →</small></Link>
      <Link className="card metric-card" href="/operations"><span>运行工作台</span><strong>进入</strong><small>健康、发布、AI 诊断 →</small></Link>
    </div>
    <div className="two-columns workbench-columns">
      <section className="card"><div className="section-title"><h3>我的应用</h3><Link href="/my/apps">查看全部 →</Link></div>
        {apps.slice(0,5).map(app=><Link key={app.id} className="workbench-item" href={"/my/apps/"+app.id}>
          <strong>{app.latestName}</strong><span className="muted">{app.listingStatus==="LISTED"?"已上架":"未上架"} · {app.latestStatus==="PENDING"?"审核中":"管理应用"}</span>
        </Link>)}
        {!apps.length&&<p className="muted">还没有负责的应用。{mayCreateApp(user)?"可从 GitHub 接入，或登记外部应用。":"可先浏览应用市场。"}</p>}
      </section>
      <section className="card"><div className="section-title"><h3>近期需求</h3><Link href="/requirements">查看全部 →</Link></div>
        {requirements.slice(0,5).map(item=><Link key={item.id} className="workbench-item" href={"/requirements/"+item.id}>
          <strong>{item.title}</strong><span className="muted">{item.status==="OPEN"?"待处理":item.status==="IN_PROGRESS"?"处理中":"已结束"}</span>
        </Link>)}
        {!requirements.length&&<p className="muted">暂无需求。可以描述一个工作问题，让平台协助寻找应用或提出需求。</p>}
      </section>
    </div>
  </SiteNav>;
}
