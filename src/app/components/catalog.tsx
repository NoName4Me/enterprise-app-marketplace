import Link from "next/link";
import { listPublished } from "@/domain/app-service";
import type { Actor } from "@/domain/actor";
import { categoryNames } from "@/lib/marketplace-labels";
import { UiIcon } from "./ui-icon";
import { AppGrid } from "./app-grid";

export type CatalogParams = { q?: string; category?: string; sort?: string; page?: string };
export async function Catalog({ actor, params, saved = false }: { actor: Actor; params: CatalogParams; saved?: boolean }) {
  const q = (params.q ?? "").slice(0, 120);
  const category = params.category && categoryNames[params.category] ? params.category : "";
  const sort = ["latest", "popular", "rating", "recommended"].includes(params.sort ?? "") ? params.sort! : "latest";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const apps = await listPublished(actor, q, { category, sort, saved, page });
  const featured = !saved && !q && !category && page === 1 && sort === "latest" ? (await listPublished(actor, "", { featured: true })).slice(0, 3) : [];
  const base = saved ? "/favorites" : "/apps";
  function href(overrides: Record<string, string>) {
    const search = new URLSearchParams({ ...(q ? { q } : {}), ...(category ? { category } : {}), sort, ...overrides });
    return `${base}?${search.toString()}`;
  }
  return <>
    {!saved && <div className="hero"><p className="eyebrow">TOOLS FOR BETTER WORK</p><h1>好工具，让工作更简单。</h1><p>发现经过审核的内部应用，找到适合你的工作工具。</p></div>}
    <div className="catalog-toolbar"><form className="search" action={base} method="GET" role="search">
      <label className="sr-only" htmlFor="market-search">搜索应用</label><UiIcon name="search" />
      <input id="market-search" type="search" name="q" placeholder="搜索应用名称或简介…" defaultValue={q} maxLength={120} />
      {category && <input type="hidden" name="category" value={category} />}<input type="hidden" name="sort" value={sort} /><button type="submit">搜索</button>
    </form><Link className="discovery-link" href="/discover"><UiIcon name="sparkles" />按工作场景找工具</Link></div>
    <nav className="category-tabs" aria-label="应用分类">{[["", "全部"], ...Object.entries(categoryNames)].map(([key, label]) => <Link key={key} href={href({ category: key, page: "1" })} aria-current={category === key ? "page" : undefined}>{label}</Link>)}</nav>
    {featured.length > 0 && <section className="featured-section"><div className="actions"><h2>编辑推荐</h2><span className="muted">管理员精选的工作工具</span></div><AppGrid apps={featured} /></section>}
    <div className="actions"><h2>{q ? `搜索“${q}”的结果` : saved ? "已收藏应用" : "全部已上架应用"}</h2><div className="catalog-meta">
      {q && <Link href={href({ q: "", page: "1" })}>清除搜索</Link>}
      <nav className="sort-tabs" aria-label="应用排序">{[["latest", "最新上架"], ["popular", "最多收藏"], ["rating", "评分最高"], ["recommended", "推荐优先"]].map(([key, label]) => <Link key={key} href={href({ sort: key, page: "1" })} aria-current={sort === key ? "page" : undefined}>{label}</Link>)}</nav>
    </div></div>
    {apps.length ? <AppGrid apps={apps} /> : <div className="empty"><UiIcon name={saved ? "bookmark" : "compass"} /><h2>{saved ? "收藏喜欢的应用，随时回来找到它" : "暂时没有符合条件的应用"}</h2><p>{saved ? "在应用卡片上点击收藏，已上架的应用会显示在这里。" : "试试其他关键词或分类，或等待新的应用审核上架。"}</p>{saved && <Link className="button" href="/apps">去发现应用</Link>}</div>}
    <div className="pagination">{page > 1 && <Link className="button button-secondary" href={href({ page: String(page - 1) })}>上一页</Link>}<span className="muted">第 {page} 页 · 本页 {apps.length} 个应用</span>{apps.length === 24 && <Link className="button button-secondary" href={href({ page: String(page + 1) })}>下一页</Link>}</div>
  </>;
}
