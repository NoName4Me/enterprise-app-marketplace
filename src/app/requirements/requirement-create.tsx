"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
const types = { NEW_APP: "新应用", FEATURE: "新增功能", BUG: "缺陷", IMPROVEMENT: "改进" };
export function RequirementCreate({ appId = "" }: { appId?: string }) {
  const router = useRouter();
  const [type, setType] = useState<keyof typeof types>(appId ? "FEATURE" : "NEW_APP");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/requirements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, title, description, appId: type === "NEW_APP" ? null : appId }),
      });
      if (!response.ok) throw new Error("提交失败，请检查内容长度及应用是否已上架。");
      const result = await response.json() as { id: string };
      router.push("/requirements/" + result.id);
      router.refresh();
    } catch(e) { setError(e instanceof Error ? e.message : "提交失败"); }
    finally { setBusy(false); }
  }
  return <section className="card"><h2>提交需求</h2>
    <p className="muted">员工可提交新应用需求。已有应用的缺陷/功能改进请从该应用详情进入，避免泄漏未上架资产。</p>
    <form onSubmit={e => void submit(e)} className="stack">
      <label>需求类型<select value={type} onChange={e => setType(e.target.value as keyof typeof types)}>
        {Object.entries(types).filter(([key]) => appId ? key !== "NEW_APP" : key === "NEW_APP").map(([key,name])=><option key={key} value={key}>{name}</option>)}
      </select></label>
      <label>标题<input required minLength={5} maxLength={140} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label>问题及期望结果<textarea required minLength={10} maxLength={4000} rows={5} value={description} onChange={e => setDescription(e.target.value)} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button disabled={busy}>{busy ? "提交中…" : "提交需求"}</button>
    </form>
  </section>;
}
