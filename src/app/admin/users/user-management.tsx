"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type ListedUser = {
  id: string; email: string; name: string; role: string | null;
  banned: boolean | null; canCreateApp: boolean;
};

export function UserManagement({ users }: { users: ListedUser[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true); setMessage("");
    try {
      const result = await authClient.admin.createUser({ name, email, password, role: "user" });
      if (result.error) throw new Error("账号创建失败");
      setPassword(""); setName(""); setEmail("");
      setMessage("员工账号已创建；请通过安全渠道将初始凭据交给员工。");
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
    <ul className="employee-list">
      {users.map(u => <li className="employee-row" key={u.id}>
        <div className="employee-info"><strong>{u.name}</strong><span>{u.email} · {u.banned ? "停用" : (u.role ?? "user")}</span>
        <span>创建权：{u.canCreateApp ? "有" : "无"}</span></div>
        <div className="employee-actions">
        <button className="button-secondary" type="button" disabled={working || Boolean(u.banned)}
          onClick={() => setCreatePermission(u.id, !u.canCreateApp)}>
          {u.canCreateApp ? "撤销创建权" : "授予创建权"}
        </button>
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
