"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { categoryNames, explainError } from "@/lib/marketplace-labels";

type Content = {
  name: string; summary: string; description: string;
  category: string; targetUrl: string; iconRef: string | null;
};
const empty: Content = {
  name: "", summary: "", description: "",
  category: "other", targetUrl: "", iconRef: null,
};
export function ApplicationForm({
  mode, appId, initial,
}: {
  mode: "create" | "edit";
  appId?: string;
  initial?: Content;
}) {
  const router = useRouter();
  // Explicit editable projection: server revision objects include read-only
  // id/status/sequence/review metadata that must never be sent back to PATCH.
  const [form, setForm] = useState<Content>(() => initial ? ({
    name: initial.name,
    summary: initial.summary,
    description: initial.description,
    category: initial.category,
    targetUrl: initial.targetUrl,
    iconRef: initial.iconRef,
  }) : { ...empty });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function set<K extends keyof Content>(key: K, value: Content[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }
  async function send(url: string, method: string, body?: unknown) {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw { code: result.error, status: response.status };
    return result;
  }
  async function run(submit: boolean) {
    setBusy(true); setError(""); setNotice("");
    let createdId: string | undefined;
    try {
      const target = mode === "create" ? "/api/my/apps" : `/api/my/apps/${appId}`;
      const result = await send(target, mode === "create" ? "POST" : "PATCH", form);
      const id = mode === "create" ? result.id as string : appId!;
      if (mode === "create") createdId = id;
      if (submit) await send(`/api/my/apps/${id}/submit`, "POST");
      setNotice(submit ? "已提交审核。" : "草稿已保存。");
      if (mode === "create") router.push(`/my/apps/${id}`);
      router.refresh();
    } catch (cause) {
      const e = cause as { code?: string; status?: number };
      setError(explainError(e.code, e.status));
      if (createdId) router.push(`/my/apps/${createdId}`);
    } finally { setBusy(false); }
  }
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(false);
  }
  return <form onSubmit={onSubmit} className="card form-panel">
    <h2>{mode === "create" ? "应用基本信息" : "编辑草稿"}</h2>
    <label>名称 <input aria-label="应用名称" maxLength={120} value={form.name}
      onChange={event => set("name", event.target.value)} /></label>
    <label>简介 <input aria-label="应用简介" maxLength={300} value={form.summary}
      onChange={event => set("summary", event.target.value)} /></label>
    <label>所属分类
      <select aria-label="应用分类" value={form.category}
        onChange={event => set("category", event.target.value)}>
        {Object.entries(categoryNames).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
      </select>
    </label>
    <label>应用详细描述 <textarea aria-label="应用详细描述" maxLength={5000} rows={5}
      value={form.description} onChange={event => set("description", event.target.value)} /></label>
    <label>HTTPS 访问地址 <input type="url" aria-label="HTTPS 访问地址"
      placeholder="https://apps.example.com" value={form.targetUrl}
      onChange={event => set("targetUrl", event.target.value)} /></label>
    <label>图标 HTTPS 地址（可选） <input type="url" aria-label="图标地址"
      placeholder="https://..." value={form.iconRef ?? ""}
      onChange={event => set("iconRef", event.target.value || null)} /></label>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="actions">
      <button disabled={busy} type="submit">{busy ? "处理中…" : "保存草稿"}</button>
      <button disabled={busy} type="button" className="button-secondary"
        onClick={() => void run(true)}>保存并提交审核</button>
    </div>
  </form>;
}
