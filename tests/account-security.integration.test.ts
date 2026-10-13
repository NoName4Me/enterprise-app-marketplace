import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { auth } from "../src/lib/auth";
import { db, rootDb } from "../src/db/client";
import { account, securityEvents, user, verification } from "../src/db/schema";
import { getActiveUser } from "../src/lib/active-user";
import { GET as catalog } from "../src/app/api/apps/route";
import { POST as recovery } from "../src/app/api/admin/users/[id]/reset/route";
import { PATCH as grant } from "../src/app/api/admin/creator-permission/route";
import { authRateStorage } from "../src/lib/security-policy";
const initial = "Fixture-only-initial-password-123!", changed = "Fixture-only-personal-password-456!", reset = "Fixture-only-recovered-password-789!";
const prefix = "security-" + randomUUID();
const ids: string[] = [];
let adminCookie = "", employeeCookie = "", employeeId = "";
function request(path: string, body?: unknown, cookie?: string) {
  return new Request("http://localhost:3000" + path, { method: body === undefined ? "GET" : "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", "x-test-client-ip": `10.23.${Math.floor(Math.random() * 254)}.${1 + Math.floor(Math.random() * 254)}`, ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function cookieOf(response: Response) {
  return (response.headers.get("set-cookie")?.split(",").find(x => x.includes("session_token")) ?? "").trim().split(";")[0];
}
async function login(email: string, password: string) {
  return auth.handler(request("/api/auth/sign-in/email", { email, password }));
}
async function change(cookie: string, currentPassword = initial, newPassword = changed) {
  return auth.handler(request("/api/auth/change-password", { currentPassword, newPassword, revokeOtherSessions: false }, cookie));
}
async function issue() {
  const response = await recovery(request(`/api/admin/users/${employeeId}/reset`, { reason: "隔离测试：已核实身份" }, adminCookie), { params: Promise.resolve({ id: employeeId }) });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.expiresInMinutes).toBe(15);
  const link = new URL(data.url); expect(link.search).toBe("");
  return new URLSearchParams(link.hash.slice(1)).get("token")!;
}
beforeAll(async () => {
  const admin = await auth.api.createUser({ body: { name: "安全测试管理员", email: prefix + "-admin@example.test", password: initial, role: "admin" } });
  ids.push(admin.user.id);
  const signedIn = await login(admin.user.email, initial); expect(signedIn.status).toBe(200);
  const response = await change(cookieOf(signedIn)); expect(response.status).toBe(200); adminCookie = cookieOf(response);
  const employee = await auth.handler(request("/api/auth/admin/create-user", { name: "安全测试员工", email: prefix + "-employee@example.test", password: initial, role: "user" }, adminCookie));
  expect(employee.status).toBe(200); employeeId = (await employee.json()).user.id; ids.push(employeeId);
});
afterAll(async () => { for (const id of ids.reverse()) await db.delete(user).where(eq(user.id, id)); });
describe.sequential("账号安全闭环", () => {
  it("初始密码账号不能访问业务或管理接口；错误/相同密码不能解除限制；改密撤销旧会话", async () => {
    const response = await login(prefix + "-employee@example.test", initial); expect(response.status).toBe(200);
    employeeCookie = cookieOf(response);
    expect((await catalog(request("/api/apps", undefined, employeeCookie))).status).toBe(403);
    const denied = await auth.handler(request("/api/auth/admin/create-user", { name: "非法", email: "denied@example.test", password: initial }, employeeCookie));
    expect(denied.status).toBe(403);
    expect((await change(employeeCookie, "wrong-password", changed)).status).toBeGreaterThanOrEqual(400);
    expect((await change(employeeCookie, initial, initial)).status).toBeGreaterThanOrEqual(400);
    const changedResponse = await change(employeeCookie); expect(changedResponse.status).toBe(200);
    expect(await getActiveUser(new Headers({ cookie: employeeCookie }))).toBeNull();
    employeeCookie = cookieOf(changedResponse);
    expect((await getActiveUser(new Headers({ cookie: employeeCookie })))?.mustChangePassword).toBe(false);
    expect((await catalog(request("/api/apps", undefined, employeeCookie))).status).toBe(200);
    const spoof = await auth.handler(request("/api/auth/update-user", { mustChangePassword: false, canCreateApp: true }, employeeCookie));
    expect([200,400]).toContain(spoof.status);
    const [stored] = await db.select().from(user).where(eq(user.id, employeeId)); expect(stored.canCreateApp).toBe(false);
  });
  it("只有管理员同源操作可生成重置；新链接使旧链接及会话失效，过期链接不可用", async () => {
    const context = { params: Promise.resolve({ id: employeeId }) };
    expect((await recovery(request("/api/admin/users/x/reset", { reason: "越权" }, employeeCookie), context)).status).toBe(403);
    const crossOrigin = request("/api/admin/users/x/reset", { reason: "跨站" }, adminCookie); crossOrigin.headers.set("origin", "https://example.test");
    expect((await recovery(crossOrigin, context)).status).toBe(403);
    const old = await issue(); expect(await getActiveUser(new Headers({ cookie: employeeCookie }))).toBeNull();
    const latest = await issue();
    expect((await auth.handler(request("/api/auth/reset-password", { token: old, newPassword: reset }))).status).toBeGreaterThanOrEqual(400);
    await db.update(verification).set({ expiresAt: new Date(0) }).where(eq(verification.identifier, "reset-password:" + latest));
    expect((await auth.handler(request("/api/auth/reset-password", { token: latest, newPassword: reset }))).status).toBeGreaterThanOrEqual(400);
  });
  it("重置令牌只可消费一次（含并发），重置后新密码可登录且解除限制", async () => {
    const token = await issue();
    const results = await Promise.all([auth.handler(request("/api/auth/reset-password", { token, newPassword: reset })), auth.handler(request("/api/auth/reset-password", { token, newPassword: reset }))]);
    expect(results.filter(x => x.ok)).toHaveLength(1);
    expect((await login(prefix + "-employee@example.test", changed)).status).toBeGreaterThanOrEqual(400);
    const signedIn = await login(prefix + "-employee@example.test", reset); expect(signedIn.status).toBe(200); employeeCookie = cookieOf(signedIn);
    expect((await getActiveUser(new Headers({ cookie: employeeCookie })))?.mustChangePassword).toBe(false);
    expect(await db.select().from(verification).where(and(eq(verification.value, employeeId), like(verification.identifier, "reset-password:%")))).toHaveLength(0);
  });
  it("敏感操作和审计同事务；审计失败时密码不改变，权限变更记录真实操作人且不记录凭据", async () => {
    await grant(new Request("http://localhost:3000/api/admin/creator-permission", { method: "PATCH", headers: { origin: "http://localhost:3000", cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ userId: employeeId, canCreateApp: true }) }));
    const [before] = await db.select({ password: account.password }).from(account).where(eq(account.userId, employeeId));
    await db.execute(sql`CREATE FUNCTION fail_password_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'PASSWORD_CHANGED' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER fail_password_audit BEFORE INSERT ON security_events FOR EACH ROW EXECUTE FUNCTION fail_password_audit()`);
    try { expect((await change(employeeCookie, reset, changed)).ok).toBe(false); }
    finally { await db.execute(sql`DROP TRIGGER fail_password_audit ON security_events`); await db.execute(sql`DROP FUNCTION fail_password_audit()`); }
    const [after] = await db.select({ password: account.password }).from(account).where(eq(account.userId, employeeId)); expect(after.password).toBe(before.password);
    const events = await rootDb.select().from(securityEvents).where(eq(securityEvents.targetUserId, employeeId));
    expect(events.some(x => x.action === "CREATE_PERMISSION_CHANGED" && x.actorUserId === ids[0])).toBe(true);
    const log = JSON.stringify(events); for (const credential of [initial, changed, reset, employeeCookie]) expect(log).not.toContain(credential);
    expect(events.some(x => x.action === "PASSWORD_RESET_COMPLETED")).toBe(true);
  });
  it("数据库限速跨并发请求原子累计；登录失败达到阈值后返回 429", async () => {
    const limits = await Promise.all(Array.from({ length: 8 }, () => authRateStorage.consume!(prefix, { window: 60, max: 3 })));
    expect(limits.filter(x => x.allowed)).toHaveLength(3);
    const simultaneous = await Promise.all(Array.from({ length: 12 }, () => login(prefix + "-employee@example.test", "invalid-password")));
    expect(simultaneous.some(response => response.status === 429)).toBe(true);
    expect(simultaneous.every(response => !response.ok)).toBe(true);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await login(prefix + "-missing@example.test", initial)).status);
    expect(codes.at(-1)).toBe(429);
  });
});
