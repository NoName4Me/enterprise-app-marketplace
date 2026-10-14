"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AccessInboxAction({ id, kind }: { id: string; kind: "decision" | "provision" }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(action: "approve" | "reject" | "provision") {
    if (busy) return;
    if (action !== "approve" && (note.trim().length < 5 || note.trim().length > 500)) {
      setError("请填写 5～500 字的说明。"); return;
    }
    setBusy(true); setError("");
    const body = action === "provision" ? { note } : { action, reason: action === "reject" ? note : undefined };
    try {
      const response = await fetch(`/api/access-requests/${id}/${action === "provision" ? "provision" : "decision"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data.error === "access_request_already_decided" || data.error === "access_request_not_ready"
          ? "状态已发生变化，请刷新页面。"
          : data.error === "access_approver_forbidden" ? "你已无权处理这项申请。" : "操作失败，请重试。");
        return;
      }
      router.refresh();
    } catch { setError("网络异常，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className="stack">
    {kind === "decision" ? <>
      <label>审批说明（驳回时必填）
        <textarea maxLength={500} rows={2} value={note} onChange={e => setNote(e.target.value)} />
      </label>
      <div className="actions">
        <button disabled={busy} onClick={() => act("approve")}>批准申请</button>
        <button className="button-secondary" disabled={busy} onClick={() => act("reject")}>驳回申请</button>
      </div>
    </> : <>
      <label>人工开通处理说明（5～500 字）
        <textarea required minLength={5} maxLength={500} rows={2} value={note}
          onChange={e => setNote(e.target.value)} placeholder="仅记录实际人工处理步骤，不表示系统已验证权限。" />
      </label>
      <div><button disabled={busy} onClick={() => act("provision")}>记录人工处理完成</button></div>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
