"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { explainError } from "@/lib/marketplace-labels";

export function RevisionAction({ appId }: { appId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function reopen() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/my/apps/${appId}/draft`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(explainError(data.error, res.status));
        return;
      }
      router.refresh();
    } catch { setError("无法连接服务，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className="actions">
    <button type="button" disabled={busy} onClick={reopen}>建立新的修改草稿</button>
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}
