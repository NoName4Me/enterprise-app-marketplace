import Link from "next/link";
import type { listPublished } from "@/domain/app-service";
import { categoryNames } from "@/lib/marketplace-labels";
import { FavoriteButton } from "./favorite-button";
import { AppIcon } from "./app-icon";
import { UiIcon } from "./ui-icon";

export function AppGrid({ apps }: { apps: Awaited<ReturnType<typeof listPublished>> }) {
  return <div className="grid">{apps.map(app => <article className="card app-card" key={app.id}>
    <div className="app-card-top"><AppIcon name={app.name} category={app.category} iconRef={app.iconRef} /><FavoriteButton appId={app.id} saved={app.saved} compact /></div>
    <Link className="app-card-link" href={`/apps/${app.id}`}><h3>{app.name}</h3><p>{app.summary}</p></Link>
    <div className="app-card-footer"><span className="tag">{categoryNames[app.category] ?? app.category}</span><span className="app-rating"><UiIcon name="star" />{app.ratingCount ? app.rating.toFixed(1) : "暂无评分"}</span></div>
    <div className="app-card-meta"><span>{app.favorites} 人收藏</span>{app.featured && <span className="featured-label">编辑推荐</span>}</div>
  </article>)}</div>;
}
