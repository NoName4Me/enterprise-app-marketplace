"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { explainError } from "@/lib/marketplace-labels";

export type ManagedListing = { id: string; name: string; listingStatus: string; featured: boolean };
export function CatalogManagement({ apps }: { apps: ManagedListing[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<ManagedListing | null>(null);
  const [reason, setReason] = useState("");
  async function update(id: string, payload: unknown) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/catalog/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(explainError(result.error, response.status));
      setSelected(null); setReason(""); setMessage("市场设置已更新。"); router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  return <><div className="card"><div className="stack">{apps.length ? apps.map(app => <article className="listing-row" key={app.id}>
    <div><strong>{app.name}</strong><p className="muted">{app.listingStatus === "LISTED" ? "已上架" : "已下架"}{app.featured ? " · 编辑推荐" : ""}</p></div><div className="employee-actions">
      {app.listingStatus === "LISTED" && <><Link className="button button-secondary" href={`/apps/${app.id}`}>查看应用</Link><button className="button-secondary" disabled={busy} onClick={() => void update(app.id, { action: "feature", featured: !app.featured })}>{app.featured ? "取消推荐" : "设为推荐"}</button></>}
      <button className={app.listingStatus === "LISTED" ? "button-danger" : "button-secondary"} disabled={busy} onClick={() => { setSelected(app); setReason(""); }}>{app.listingStatus === "LISTED" ? "下架" : "恢复上架"}</button>
    </div></article>) : <p className="muted">暂无曾经通过审核的应用。</p>}</div></div>
    {selected && <form className="card form-panel content" onSubmit={e => { e.preventDefault(); void update(selected.id, { action: selected.listingStatus === "LISTED" ? "unlist" : "relist", reason }); }}><h2>{selected.listingStatus === "LISTED" ? "下架" : "恢复上架"}：{selected.name}</h2><p className="muted">恢复时仍使用最后一次审核通过的内容，不会公开待审修改。</p><label>操作原因<textarea rows={3} required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><div className="actions"><button disabled={busy}>确认操作</button><button className="button-secondary" type="button" onClick={() => setSelected(null)}>取消</button></div></form>}
    {message && <p className="notice" role="status">{message}</p>}</>;
}
