import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SiteNav } from "@/app/components/site-nav";
import { getOwnedApplication } from "@/domain/app-service";
import { AppError } from "@/domain/app-errors";
import { getPageUser } from "@/lib/page-user";
import { mayCreateApp } from "@/lib/access";
import { statusName } from "@/lib/marketplace-labels";
import { AssetWorkspace } from "@/app/components/asset-workspace";
import { GithubLivePanel } from "@/app/components/github-live-panel";
import { DevopsEvidencePanel } from "@/app/components/devops-evidence-panel";
import { HostedRuntimePanel } from "@/app/components/hosted-runtime-panel";
import { ApplicationForm } from "../application-form";
import { RevisionAction } from "../revision-action";
import { DeleteDraftButton } from "../delete-draft-button";
import { HostedReleasePanel } from "@/app/components/hosted-release-panel";
export const dynamic="force-dynamic";
type View="overview"|"releases"|"operations"|"requirements"|"settings"|"advanced";
const tabs:{view:View;label:string}[]=[
 {view:"overview",label:"概览"},
 {view:"releases",label:"发布"},
 {view:"operations",label:"运行"},
 {view:"requirements",label:"需求"},
 {view:"settings",label:"设置"},
 {view:"advanced",label:"高级"},
];
export default async function ManagedApplication({params,searchParams}:{
 params:Promise<{id:string}>;searchParams:Promise<{view?:string}>;
}){
 const user=await getPageUser(await headers());
 if(!user)redirect("/login");
 const id=(await params).id,chosen=(await searchParams).view;
 const view:View=tabs.some(x=>x.view===chosen)?chosen as View:"overview";
 let app:Awaited<ReturnType<typeof getOwnedApplication>>;
 try{app=await getOwnedApplication({id:user.id},id)}
 catch(e){if(e instanceof AppError&&e.status===404)notFound();throw e}
 const latest=app.revisions[0];
 const editable=mayCreateApp(user)&&app.lifecycleStatus!=="RETIRED";
 const hosted=app.sourceKind==="HOSTED";
 const testEndpoint=app.hostedEndpoints.find(x=>x.environment==="TEST");
 const productionEndpoint=app.hostedEndpoints.find(x=>x.environment==="PRODUCTION");
 const root="/api/my/apps/"+id;
 const repo=app.sourceRepository;
 return <SiteNav user={user} title={latest.name||"应用详情"}>
  <Link href="/my/apps" className="back-link">← 返回我管理的应用</Link>
  <header className="app-profile-header">
   <div><p className="eyebrow">{hosted?"平台托管 · GitHub":"外部应用 · 链接接入"}</p>
    <h2>{latest.name||"未命名应用"}</h2><p>{latest.summary||"尚未填写应用介绍"}</p></div>
   <div className="app-profile-status"><span className="tag">{app.listingStatus==="LISTED"?"市场已上架":"未上架"}</span>
     <span className="tag">{statusName(latest.status)}</span></div>
  </header>
  <nav className="app-detail-tabs" aria-label="应用工作台">
   {tabs.map(t=><Link key={t.view} href={"/my/apps/"+id+"?view="+t.view}
      aria-current={view===t.view?"page":undefined}>{t.label}</Link>)}
  </nav>
  {view==="overview"&&<div className="stack">
    <section className="app-status-grid">
      <div className="card app-status-tile"><span>应用来源</span><strong>{hosted?"GitHub 托管":"外部链接"}</strong></div>
      <div className="card app-status-tile"><span>测试环境</span><strong>{hosted?(testEndpoint?.state==="READY"?"已验证部署":"已预留 · 未验证"):"不适用"}</strong></div>
      <div className="card app-status-tile"><span>生产环境</span><strong>{hosted?(productionEndpoint?.state==="READY"?"已验证部署":"尚未发布"):"由外部系统管理"}</strong></div>
    </section>
    <section className="card">
      <div className="section-title"><h3>下一步</h3><Link href={"/my/apps/"+id+"?view=settings"}>管理应用信息 →</Link></div>
      <p>{hosted?"应用已与 GitHub 仓库建立登记关联。接下来需要构建镜像、验证测试部署，再晋级相同镜像到生产。":"已登记的外部应用不会由本平台部署。提交市场审核通过后，员工可从市场访问目标地址。"}</p>
      {hosted&&repo&&<p><a target="_blank" rel="noopener noreferrer" href={"https://github.com/"+repo}>查看 GitHub 仓库 →</a></p>}
      {!hosted&&latest.targetUrl&&<p><a target="_blank" rel="noopener noreferrer" href={latest.targetUrl}>打开应用 →</a></p>}
      <div className="actions"><Link className="button" href={"/my/apps/"+id+"?view="+(hosted?"releases":"settings")}>
        {hosted?"查看部署进度":"查看应用设置"}</Link>
        {app.listingStatus==="LISTED"&&<Link href={"/apps/"+id} className="button button-secondary">在应用市场中查看</Link>}
      </div>
    </section>
    <section className="card"><div className="section-title"><h3>应用工作台</h3></div>
      <div className="quick-links">
       <Link href={"/my/apps/"+id+"?view=releases"}>发布与版本 <span>→</span></Link>
       <Link href={"/my/apps/"+id+"?view=operations"}>运行与诊断 <span>→</span></Link>
       <Link href={"/my/apps/"+id+"?view=requirements"}>需求与改进 <span>→</span></Link>
      </div>
    </section>
   </div>}
  {view==="releases"&&<div className="stack">
    <section className="card release-overview">
      <div className="section-title"><h3>发布与版本</h3><span className="tag">{hosted?"平台托管":"外部应用"}</span></div>
      {!hosted?<p>这是外部应用。部署、回滚和版本更新由目标系统负责；平台只管理应用访问入口和市场信息。</p>:<>
        <p>测试环境和生产环境由平台自动创建。生产只能晋级测试验证通过的同一个镜像 Digest，不能直接从 GitHub 分支跳过测试部署。</p>
        <div className="release-lanes"><article><h4>测试环境</h4><p className="muted">预留端口：{testEndpoint?.port??"未分配"} · {testEndpoint?.state??"未预留"}</p>
          {testEndpoint?.url?<a href={testEndpoint.url} target="_blank" rel="noopener noreferrer">访问测试环境 →</a>:<span className="tag">待验证镜像与访问</span>}</article>
        <article><h4>生产环境</h4><p className="muted">预留端口：{productionEndpoint?.port??"未分配"} · {productionEndpoint?.state??"未预留"}</p>
          {productionEndpoint?.url?<a href={productionEndpoint.url} target="_blank" rel="noopener noreferrer">访问生产环境 →</a>:<span className="tag">尚未发布</span>}</article></div>
        <p className="notice">发布由 Temporal 发起构建，并将验证后的镜像部署到应用的 Kubernetes 环境。未配置构建模板、环境权限或访问入口时将明确显示失败原因；仅实际验证通过后标记可用。</p>
      </>}
    </section>
    {hosted&&repo&&<HostedReleasePanel root={root} repo={repo}
      productionDigest={productionEndpoint?.imageDigest??null}/>}
  </div>}
  {view==="operations"&&<div className="stack">
    {!hosted&&<p className="notice">外部应用尚未接入平台托管监控；仅在明确绑定观测来源后提供诊断。</p>}
    {hosted?<HostedRuntimePanel root={root}/>:<DevopsEvidencePanel root={root} appId={id}/>}
  </div>}
  {view==="requirements"&&<section className="card">
    <h3>需求与改进</h3><p>从应用工作台提出问题，需求会自动关联该应用，之后可由负责人跟踪 AI 分析、编码任务和 PR 审核。</p>
    <div className="actions"><Link className="button" href={"/requirements?appId="+id}>提出此应用的需求</Link>
      <Link className="button button-secondary" href="/requirements">查看全部需求</Link></div>
  </section>}
  {view==="settings"&&<div className="stack">
    <section className="card"><h3>来源配置</h3><p>类型：{hosted?"平台托管":"外部应用"}</p>
     {repo&&<p>GitHub 仓库：<a href={"https://github.com/"+repo} target="_blank" rel="noopener noreferrer">{repo}</a></p>}
     <p className="muted">来源类型创建后固定；更改托管关系需要后续安全的重接入流程。</p>
    </section>
    {app.lifecycleStatus==="RETIRED"&&<p className="notice">应用已退役，登记信息只读。</p>}
    {latest.status==="DRAFT"&&editable&&<ApplicationForm mode="edit" appId={id} initial={latest} sourceKind={app.sourceKind} sourceRepository={repo}/>}
    {latest.status==="DRAFT"&&!editable&&<p className="notice">当前账号不能修改草稿。</p>}
    {latest.status==="PENDING"&&<p className="notice">应用信息正在审核，当前版本暂不可编辑。</p>}
    {(latest.status==="REJECTED"||latest.status==="APPROVED")&&editable&&<RevisionAction appId={id}/>}
    {editable && app.listingStatus==="UNLISTED" && !app.publishedRevisionId &&
      app.revisions.length===1 && latest.status==="DRAFT" &&
      <DeleteDraftButton appId={id} appName={latest.name || "未命名应用"}/>}
    <section className="card"><h3>市场版本记录</h3>{app.revisions.map(rev=><article key={rev.id} className="workbench-item">
      <strong>第 {rev.sequence} 版 · {rev.name}</strong><span className="muted">{statusName(rev.status)}</span>
    </article>)}</section>
  </div>}
  {view==="advanced"&&<div className="stack">
    <p className="notice">高级管理面向维护人员。旧组件/环境/生命周期记录仍保留，不影响已存在的资产和审计历史；新托管应用不需要手工维护这些关联。</p>
    <AssetWorkspace actor={{id:user.id}} appId={id} canWrite={mayCreateApp(user)}/>
  </div>}
 </SiteNav>;
}
