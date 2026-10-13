"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { getCommunity } from "@/domain/community-service";
import { explainError } from "@/lib/marketplace-labels";
import { UiIcon } from "@/app/components/ui-icon";

type Community = Awaited<ReturnType<typeof getCommunity>>;
type Action = { kind: "feedback" | "discussion"; id: string; action: "reply" | "hide" };
export function CommunityPanel({ appId, data }: { appId: string; data: Community }) {
  const router = useRouter();
  const own = data.feedback.find(x => x.userId === data.currentUserId);
  const [rating, setRating] = useState(own?.rating ?? 5);
  const [body, setBody] = useState(own?.body ?? "");
  const [discussion, setDiscussion] = useState("");
  const [active, setActive] = useState<Action | null>(null);
  const [actionText, setActionText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function send(path: string, method: string, payload: unknown, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/apps/${appId}/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(explainError(result.error, response.status));
      setMessage(success); router.refresh(); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); return false; }
    finally { setBusy(false); }
  }
  async function review(event: FormEvent) { event.preventDefault(); await send("feedback", "PUT", { rating, body }, "评价已保存。"); }
  async function post(event: FormEvent) { event.preventDefault(); if (await send("discussions", "POST", { body: discussion }, "讨论已发布。")) setDiscussion(""); }
  function choose(action: Action) { setActive(action); setActionText(""); }
  async function act(event: FormEvent) {
    event.preventDefault(); if (!active) return;
    const ok = active.kind === "discussion" && active.action === "reply"
      ? await send("discussions", "POST", { parentId: active.id, body: actionText }, "回复已发布。")
      : await send("community", "PATCH", { ...active, ...(active.action === "hide" ? { reason: actionText } : { body: actionText }) }, active.action === "hide" ? "内容已隐藏。" : "回复已保存。");
    if (ok) setActive(null);
  }
  function controls(kind: "feedback" | "discussion", id: string, author: string) {
    return <div className="community-actions">
      {kind === "discussion" && <button className="text-button" disabled={busy} onClick={() => choose({ kind, id, action: "reply" })}>回复</button>}
      {kind === "feedback" && data.isOwner && <button className="text-button" disabled={busy} onClick={() => choose({ kind, id, action: "reply" })}>发布者回复</button>}
      {author === data.currentUserId && <button className="text-button" disabled={busy} onClick={() => void send("community", "PATCH", { kind, id, action: "delete" }, "内容已删除。")}>删除我的{kind === "feedback" ? "评价" : "讨论"}</button>}
      {data.canModerate && <button className="text-button danger-text" disabled={busy} onClick={() => choose({ kind, id, action: "hide" })}>隐藏内容</button>}
    </div>;
  }
  return <section className="community-section" aria-label="评价与讨论">
    <div className="actions"><h2>使用评价</h2><span className="rating-summary"><UiIcon name="star" />{data.ratingCount ? `${data.rating.toFixed(1)} / 5 · ${data.ratingCount} 人评分` : "还没有评分"}</span></div>
    <div className="community-columns"><form className="card form-panel feedback-form" onSubmit={review}>
      <h3>{own ? "修改我的评价" : "分享你的使用体验"}</h3>
      <fieldset className="star-picker"><legend>你的评分</legend>{[1, 2, 3, 4, 5].map(value => <label key={value}><input type="radio" name="rating" value={value} checked={rating === value} onChange={() => setRating(value)} /><span aria-hidden="true" className={value <= rating ? "filled" : ""}>★</span><span className="sr-only">{value} 星</span></label>)}</fieldset>
      <label>使用评价（可选）<textarea rows={4} maxLength={2000} value={body} onChange={e => setBody(e.target.value)} placeholder="它帮你解决了什么问题？有哪些可以改进的地方？" /></label>
      <button disabled={busy} type="submit">{own ? "更新评价" : "发布评价"}</button>
    </form><div className="card feedback-list">{data.feedback.length ? data.feedback.map(item => <article className="community-item" key={item.id}>
      <div className="community-author"><strong>{item.name}</strong><span>{"★".repeat(item.rating)}{"☆".repeat(5 - item.rating)}</span></div>
      {item.body && <p className="pre-wrap">{item.body}</p>}<span className="muted community-date">{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</span>
      {item.ownerReply && <div className="owner-reply"><strong>发布者回复</strong><p className="pre-wrap">{item.ownerReply}</p></div>}{controls("feedback", item.id, item.userId)}
    </article>) : <div className="community-placeholder"><UiIcon name="star" /><p>还没有人评价这个应用。<br/>分享体验，帮助同事做选择。</p></div>}</div></div>
    <div className="actions"><h2>应用讨论</h2><span className="muted">分享经验、反馈问题</span></div>
    <div className="card"><form className="discussion-form" onSubmit={post}><label>发起讨论<textarea rows={3} maxLength={2000} required value={discussion} onChange={e => setDiscussion(e.target.value)} placeholder="交流使用心得，或向应用负责人提问…" /></label><button disabled={busy} type="submit">发布讨论</button></form>
      {data.discussions.filter(x => !x.parentId).map(item => <article className="community-item" key={item.id}><div className="community-author"><strong>{item.name}</strong><span className="muted community-date">{new Date(item.createdAt).toLocaleDateString("zh-CN")}</span></div><p className="pre-wrap">{item.body}</p>{controls("discussion", item.id, item.userId)}
        {data.discussions.filter(x => x.parentId === item.id).map(reply => <div className="discussion-reply" key={reply.id}><strong>{reply.name}</strong><p className="pre-wrap">{reply.body}</p><div className="community-actions">{reply.userId === data.currentUserId && <button className="text-button" disabled={busy} onClick={() => void send("community", "PATCH", { kind: "discussion", id: reply.id, action: "delete" }, "回复已删除。")}>删除我的回复</button>}{data.canModerate && <button className="text-button danger-text" disabled={busy} onClick={() => choose({ kind: "discussion", id: reply.id, action: "hide" })}>隐藏内容</button>}</div></div>)}
      </article>)}{!data.discussions.length && <p className="muted">还没有讨论，欢迎分享第一个话题。</p>}
    </div>
    {active && <form className="card form-panel action-panel" onSubmit={act}><h3>{active.action === "hide" ? "隐藏内容" : "回复内容"}</h3><label>{active.action === "hide" ? "隐藏原因" : "回复"}<textarea required rows={3} maxLength={active.action === "hide" ? 500 : 2000} value={actionText} onChange={e => setActionText(e.target.value)} /></label><div className="actions"><button disabled={busy} type="submit">{active.action === "hide" ? "确认隐藏" : "发布回复"}</button><button className="button-secondary" type="button" onClick={() => setActive(null)}>取消</button></div></form>}
    {message && <p className="notice" role="status">{message}</p>}{error && <p className="error" role="alert">{error}</p>}
  </section>;
}
