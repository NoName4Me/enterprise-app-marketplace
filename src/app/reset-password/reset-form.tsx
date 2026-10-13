"use client";
import Link from "next/link";
import { useState, useEffect, useSyncExternalStore, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
const subscribe = () => () => {};
export function ResetForm() {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [token] = useState(() => typeof window === "undefined" ? null : new URLSearchParams(window.location.hash.slice(1)).get("token"));
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  // Keep the one-time token out of copied URLs, history entries and external referrers.
  useEffect(() => { window.history.replaceState(null, "", "/reset-password"); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!token) return setError("重置链接不可用，请向管理员申请新链接。");
    if (password !== confirm) return setError("两次输入的新密码不一致。");
    setBusy(true);
    try {
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) throw new Error("重置失败，链接可能已过期或使用过。请向管理员申请新链接。");
      setPassword(""); setConfirm(""); setDone(true);
    } catch (error) { setError(error instanceof Error ? error.message : "服务暂不可用。"); }
    finally { setBusy(false); }
  }
  if (!ready) return <p>正在读取重置链接…</p>;
  if (!token) return <><h1>重置链接不可用</h1><p>请联系管理员获取新的限时重置链接。</p><Link href="/login">返回登录</Link></>;
  if (done) return <><h1>密码已重置</h1><p>旧会话已失效，请使用新密码重新登录。</p><Link className="button" href="/login">返回登录</Link></>;
  return <><h1>重置登录密码</h1><p className="muted">链接仅可使用一次，有效期 15 分钟。</p><form onSubmit={submit}>
    <label>新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></label>
    <label>确认新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)}/></label>
    {error && <p className="error" role="alert">{error}</p>}<button disabled={busy} type="submit">{busy ? "保存中…" : "设置新密码"}</button>
  </form></>;
}
