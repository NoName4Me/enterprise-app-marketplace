import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { auth, bootstrapInitialAdministrator } from "../src/lib/auth";
import { db } from "../src/db/client";
import { user, securityEvents } from "../src/db/schema";

const password = "Fixture-only-personal-password-123!";
const prefix = "bootstrap-negative-" + randomUUID();
function create(body: unknown, cookie?: string) {
  return auth.handler(new Request("http://localhost:3000/api/auth/admin/create-user", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }));
}
describe("受控初始化与 HTTP 隔离", () => {
  it("非空库拒绝服务端初始化且没有账号或审计副作用", async () => {
    const before = await db.select({ id: user.id }).from(user);
    await expect(bootstrapInitialAdministrator({ email: prefix + "@example.test", name: "重复初始化", password })).rejects.toThrow("already contains users");
    expect(await db.select({ id: user.id }).from(user)).toHaveLength(before.length);
    expect(await db.select().from(securityEvents).where(eq(securityEvents.action, "ACCOUNT_CREATED"))).not.toHaveLength(0);
  });
  it("缺少会话的直接 API 与 HTTP 请求均不能凭请求形态获得创建权限", async () => {
    await expect(auth.api.createUser({ body: { email: prefix + "-api@example.test", name: "绕过", password, role: "admin" } })).rejects.toThrow();
    for (const data of [undefined, { emailVerified: true }, { role: "admin" }, { canCreateApp: true }, { mustChangePassword: false }, { banned: false }]) {
      const response = await create({ email: prefix + "-http@example.test", name: "绕过", password, role: "admin", data });
      expect([401, 403]).toContain(response.status);
    }
    expect(await db.select().from(user).where(sql`${user.email} LIKE ${prefix + "%"}`)).toHaveLength(0);
  });
  it("初始化账号已验证邮箱、强制改密且创建审计完整", async () => {
    const [admin] = await db.select().from(user).where(eq(user.email, "t01-admin@example.test"));
    expect(admin.role).toBe("admin");
    expect(admin.emailVerified).toBe(true);
    // prepare-test-admin 已真实改密；没有绕过首登约束。
    expect(admin.mustChangePassword).toBe(false);
    const events = await db.select().from(securityEvents).where(eq(securityEvents.targetUserId, admin.id));
    expect(events.some(event => event.action === "ACCOUNT_CREATED" && (event.after as { mustChangePassword?: boolean } | null)?.mustChangePassword === true)).toBe(true);
    expect(events.some(event => event.action === "PASSWORD_CHANGED")).toBe(true);
  });
});
