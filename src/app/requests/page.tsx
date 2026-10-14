import Link from "next/link";
import { headers } from "next/headers";
import { SiteNav } from "@/app/components/site-nav";
import { getPageUser } from "@/lib/page-user";
import { listMyAccessRequests, listAccessInbox } from "@/domain/access-request-service";
import { accessRequestMessage } from "@/domain/access-request-labels";
import { AccessInboxAction } from "./access-inbox-action";

export const dynamic = "force-dynamic";
export default async function RequestsPage() {
  const current = await getPageUser(await headers());
  const [mine, inbox] = await Promise.all([
    listMyAccessRequests({ id: current.id }),
    listAccessInbox({ id: current.id }),
  ]);
  return <SiteNav user={current} title="申请与待办">
    <p className="muted">查看应用使用申请及需要你处理的审批。人工开通记录不代表目标系统已自动验证权限。</p>
    <section className="asset-group">
      <h2>我的申请</h2>
      {!mine.length && <p className="empty">暂无申请。可从 <Link href="/apps">应用市场</Link> 的详情页发起。</p>}
      <div className="stack">
        {mine.map(item => <article className="card" key={item.id}>
          <div className="actions"><strong>{item.name || "应用已下架"}</strong>
            <span className="tag">{accessRequestMessage(item.status, item.provisioningStatus)}</span></div>
          <p>申请理由：{item.reason}</p>
          {item.decisionReason && <p className="muted">审批说明：{item.decisionReason}</p>}
          {item.provisioningNote && <p className="muted">人工处理记录：{item.provisioningNote}</p>}
          <p className="muted">提交：{item.createdAt.toLocaleString("zh-CN")} ·
            <Link href={`/apps/${item.appId}`}> 查看应用</Link></p>
        </article>)}
      </div>
    </section>
    <section className="asset-group">
      <h2>待我处理</h2>
      {!inbox.length && <p className="empty">当前没有需要你处理的使用申请。</p>}
      <div className="stack">
        {inbox.map(item => <article className="card" key={item.id}>
          <div className="actions"><strong>{item.name || "应用已下架"}</strong>
            <span className="tag">{item.status === "PENDING" ? "等待审批" : "等待人工开通"}</span></div>
          <p>申请人：{item.requesterName} · 理由：{item.reason}</p>
          <AccessInboxAction id={item.id} kind={item.status === "PENDING" ? "decision" : "provision"} />
        </article>)}
      </div>
    </section>
  </SiteNav>;
}
