import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getActiveUser } from "@/lib/active-user";
import { listPublished } from "@/domain/app-service";
import { matchScenarios, scenarios } from "@/domain/discovery";
import { SiteNav } from "@/app/components/site-nav";
import { AppGrid } from "@/app/components/app-grid";
import { UiIcon } from "@/app/components/ui-icon";
export const dynamic = "force-dynamic";
export default async function Discover({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getActiveUser(await headers());
  if (!user) redirect("/login");
  const q = (await searchParams).q?.trim().slice(0, 120) ?? "";
  // Scan published pages only; do not mix private revisions into matching.
  const apps: Awaited<ReturnType<typeof listPublished>> = [];
  if (q) for (let page = 1; page <= 20; page++) {
    const batch = await listPublished({ id: user.id }, "", { page });
    apps.push(...batch); if (batch.length < 24) break;
  }
  const matches = matchScenarios(q, apps);
  return <SiteNav user={user}><section className="discovery-hero"><span className="discovery-symbol"><UiIcon name="sparkles" /></span><p className="eyebrow">FIND YOUR NEXT TOOL</p><h1>从工作场景，找到合适的应用。</h1><p className="muted">描述你想解决的问题，我们从已上架工具中寻找候选。</p><form className="scenario-form" action="/discover" method="GET"><label className="sr-only" htmlFor="scenario-input">描述工作需求</label><textarea id="scenario-input" name="q" rows={3} maxLength={120} required defaultValue={q} placeholder="例如：我想查看业务数据趋势，最好能快速生成报表。" /><button type="submit"><UiIcon name="sparkles" />查找应用</button></form><div className="scenario-examples">{scenarios.map(s => <Link key={s} href={`/discover?q=${encodeURIComponent(s)}`}>{s} ↗</Link>)}</div><p className="discovery-note">当前使用场景与关键词匹配，尚未接入 AI 模型。候选能力以应用登记信息为准。</p></section>
    {q && <section><div className="actions"><h2>{matches.length ? `为“${q}”找到 ${matches.length} 个候选` : "暂时没有足够匹配的应用"}</h2></div>{matches.length ? matches.map(match => <div className="discovery-result" key={match.app.id}><AppGrid apps={[match.app]} /><div className="match-evidence"><p className="eyebrow">匹配依据</p><p>{match.reason}</p><p className="muted">具体能力、目标系统权限和使用方式，请查看应用介绍或联系负责人确认。</p></div></div>) : <div className="empty"><p>已上架信息不足以支持这个需求。试着描述具体任务，或换一组关键词。</p><Link href="/apps">浏览全部应用 →</Link></div>}</section>}
  </SiteNav>;
}
