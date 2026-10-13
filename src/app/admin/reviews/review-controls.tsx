"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { explainError } from "@/lib/marketplace-labels";

export function ReviewControls({ revisionId }: { revisionId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(action: "approve" | "reject") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/reviews/${revisionId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "reject" ? JSON.stringify({ reason }) : undefined,
      });
      const result = await response.json();
      if (!response.ok) {
        setError(explainError(result.error, response.status));
        return;
      }
      router.push("/admin/reviews");
      router.refresh();
    } catch { setError("无法连接服务，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className="card form-panel">
    <h2>审核操作</h2>
    <p className="muted">批准后才会更新员工可见内容；驳回不会影响已上架版本。</p>
    <label>驳回原因（驳回时必填）
      <textarea value={reason} onChange={event => setReason(event.target.value)}
        rows={3} maxLength={500} aria-label="驳回原因" />
    </label>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="actions">
      <button type="button" disabled={busy} onClick={() => void decide("approve")}>批准上架</button>
      <button className="button-danger" type="button" disabled={busy || !reason.trim()}
        onClick={() => void decide("reject")}>驳回申请</button>
    </div>
  </section>;
}
