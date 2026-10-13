"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UiIcon } from "./ui-icon";
import { explainError } from "@/lib/marketplace-labels";

export function FavoriteButton({ appId, saved, compact = false }: { appId: string; saved: boolean; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/apps/${appId}/favorite`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saved: !saved }) });
      if (!response.ok) { const data = await response.json(); throw new Error(explainError(data.error, response.status)); }
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "收藏失败"); }
    finally { setBusy(false); }
  }
  return <div className="favorite-control"><button className={compact ? "favorite-icon" : "button-secondary"} type="button" aria-label={saved ? "取消收藏" : "收藏应用"} aria-pressed={saved} disabled={busy} onClick={toggle}>
    <UiIcon name="bookmark" />{!compact && (saved ? "已收藏" : "收藏应用")}</button>{error && <p className="error" role="alert">{error}</p>}</div>;
}
