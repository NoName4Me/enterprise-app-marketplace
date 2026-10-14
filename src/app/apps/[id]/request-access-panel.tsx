"use client";

import { useState } from "react";
import Link from "next/link";
import { accessRequestMessage } from "@/domain/access-request-labels";

type Request = {
  id: string; reason: string; status: "PENDING" | "APPROVED" | "REJECTED";
  provisioningStatus: "NOT_STARTED" | "PENDING" | "MANUAL_RECORDED";
  decisionReason: string | null; provisioningNote: string | null;
};
const errors: Record<string, string> = {
  access_request_already_active: "已有未结束的申请，请查看申请记录。",
  invalid_reason: "请填写 5～500 字的申请理由。",
  unauthorized: "登录状态已失效，请重新登录。",
  forbidden: "当前账号没有申请权限。",
  not_found: "该应用已下架或不可申请。",
};

export function RequestAccessPanel({ appId, initial }: { appId: string; initial: Request | null }) {
  const [current, setCurrent] = useState<Request | null>(initial);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/apps/${appId}/access-requests`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json();
      if (!response.ok) { setError(errors[data.error] || "申请未提交，请检查后重试。"); return; }
      setCurrent({ id: data.id, reason, status: "PENDING", provisioningStatus: "NOT_STARTED",
        decisionReason: null, provisioningNote: null });
      setReason("");
    } catch { setError("网络异常，请稍后重试。"); }
    finally { setBusy(false); }
  }
  return <section className="card content">
    <div className="actions"><h2>申请使用</h2><Link href="/requests">查看我的申请及待办 →</Link></div>
    <p className="muted">门户审批不等于目标系统授权。当前未连接目标系统权限数据，不能自动判断你是否已获得使用权。</p>
    {current && <div className="notice">
      <strong>{accessRequestMessage(current.status, current.provisioningStatus)}</strong>
      {current.decisionReason && <p>审批说明：{current.decisionReason}</p>}
      {current.provisioningNote && <p>人工处理记录：{current.provisioningNote}</p>}
    </div>}
    {(!current || current.status === "REJECTED") && <form onSubmit={submit} className="stack">
      <label>使用理由（5～500 字）
        <textarea required minLength={5} maxLength={500} rows={3} value={reason}
          onChange={e => setReason(e.target.value)} placeholder="描述你希望使用该应用完成的工作。" />
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      <div><button disabled={busy}>{busy ? "提交中…" : current ? "重新申请" : "提交使用申请"}</button></div>
    </form>}
  </section>;
}
