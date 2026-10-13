"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
export function PasswordForm({ required }: { required: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirm) return setError("两次输入的新密码不一致。");
    if (password === current) return setError("新密码不能与原密码相同。");
    setBusy(true);
    try {
      const result = await authClient.changePassword({ currentPassword: current, newPassword: password, revokeOtherSessions: true });
      if (result.error) throw new Error(result.error.status === 429 ? "操作过于频繁，请稍后重试。" : "修改失败，请检查当前密码及新密码要求。");
      setCurrent(""); setPassword(""); setConfirm(""); router.replace("/apps"); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "服务暂不可用，请稍后重试。"); }
    finally { setBusy(false); }
  }
  return <section className="card security-card"><h2>{required ? "修改初始密码" : "修改登录密码"}</h2><p className="muted">{required ? "为保障账号安全，请先设置你自己的密码，再进入应用市场。" : "修改成功后，其他设备和旧会话将退出登录。"}</p><form onSubmit={submit}>
    <label>当前密码<input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required maxLength={128}/></label>
    <label>新密码<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128}/></label>
    <label>确认新密码<input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={12} maxLength={128}/></label>
    <p className="muted">密码需 12–128 个字符，且不能与当前密码相同。</p>{error && <p className="error" role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? "保存中…" : "保存新密码"}</button>
  </form></section>;
}
