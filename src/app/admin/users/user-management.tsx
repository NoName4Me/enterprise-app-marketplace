"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type ListedUser = {
  id: string; email: string; name: string; role: string | null;
  banned: boolean | null; canCreateApp: boolean; mustChangePassword: boolean;
};

export function UserManagement({ users, currentUserId }: { users: ListedUser[]; currentUserId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [resetId, setResetId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [recoveryUrl, setRecoveryUrl] = useState("");
  const [working, setWorking] = useState(false);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true); setMessage("");
    try {
      const result = await authClient.admin.createUser({ name, email, password, role: "user" });
      if (result.error) throw new Error("账号创建失败");
      setPassword(""); setName(""); setEmail("");
      setMessage("员工账号已创建；请通过安全渠道交付初始凭据，员工首次登录必须改密。");
      router.refresh();
    } catch { setMessage("创建失败，请检查账号是否重复及密码是否合规。"); }
    finally { setWorking(false); }
  }

  async function setCreatePermission(userId: string, allowed: boolean) {
    setWorking(true); setMessage("");
    try {
      const result = await fetch("/api/admin/creator-permission", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, canCreateApp: allowed }),
      });
      if (!result.ok) throw new Error("权限更新失败");
      router.refresh();
    } catch { setMessage("权限更新失败"); }
    finally { setWorking(false); }
  }

  async function setBanned(userId: string, banned: boolean) {
    setWorking(true); setMessage("");
    try {
      const result = banned
        ? await authClient.admin.banUser({ userId, banReason: "由平台管理员停用" })
        : await authClient.admin.unbanUser({ userId });
      if (result.error) throw new Error("停用状态更新失败");
      router.refresh();
    } catch { setMessage("停用状态更新失败"); }
    finally { setWorking(false); }
  }

  async function reset(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setMessage(""); setRecoveryUrl("");
    try {
      const response = await fetch(`/api/admin/users/${resetId}/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      if (!response.ok) throw new Error();
      const data = await response.json(); setRecoveryUrl(data.url); setResetId(null); setReason("");
      setMessage("重置链接已生成，15 分钟内有效。该账号的旧会话和旧重置链接已失效。"); router.refresh();
    } catch { setMessage("无法生成重置链接，请检查账号状态或稍后重试。"); }
    finally { setWorking(false); }
  }
  return <div className="user-management">
    <section className="card">
    <h2>创建员工</h2>
    <form className="user-create-form" onSubmit={create}>
      <label>姓名<input value={name} onChange={e => setName(e.target.value)} required /></label>
      <label>邮箱<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>初始密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} required /></label>
      <button type="submit" disabled={working}>创建账号</button>
    </form>
    {message && <p role="status">{message}</p>}
    </section>
    <section className="card">
    <h2>已开通员工（前 100 条）</h2>
    {resetId && <form className="recovery-panel" onSubmit={reset}><h3>生成限时重置链接</h3><p>先通过企业认可的渠道核实员工身份，再填写处理原因。生成链接会立即使该账号退出所有旧会话。</p><label>核实情况与重置原因<textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label><div className="actions"><button disabled={working}>生成重置链接</button><button type="button" className="button-secondary" onClick={() => setResetId(null)}>取消</button></div></form>}
    {recoveryUrl && <div className="recovery-panel"><label>一次性重置链接<input readOnly value={recoveryUrl} autoComplete="off"/></label><p className="muted">请通过已核实的私密渠道交给员工，不要发布到群聊或工单。链接关闭后不再展示。</p><button type="button" className="button-secondary" onClick={() => setRecoveryUrl("")}>关闭链接展示</button></div>}
    <ul className="employee-list">
      {users.map(u => <li className="employee-row" key={u.id}>
        <div className="employee-info"><strong>{u.name}</strong><span>{u.email} · {u.banned ? "停用" : (u.role ?? "user")}</span>
        <span>{u.mustChangePassword ? "待首次改密" : "无需首次改密"}</span><span>创建权：{u.canCreateApp ? "有" : "无"}</span></div>
        <div className="employee-actions">
        <button className="button-secondary" type="button" disabled={working || Boolean(u.banned)}
          onClick={() => setCreatePermission(u.id, !u.canCreateApp)}>
          {u.canCreateApp ? "撤销创建权" : "授予创建权"}
        </button>
        {u.id !== currentUserId && <button className="button-secondary" type="button" disabled={working || Boolean(u.banned)} onClick={() => { setResetId(u.id); setRecoveryUrl(""); setReason(""); }}>重置密码</button>}
        {!(u.role ?? "user").split(",").includes("admin") && (
          <button className={u.banned ? "button-secondary" : "button-danger"} type="button" disabled={working} onClick={() => setBanned(u.id, !u.banned)}>
            {u.banned ? "恢复账号" : "停用账号"}
          </button>
        )}
        </div>
      </li>)}
    </ul>
    </section>
  </div>;
}
