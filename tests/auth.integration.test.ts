import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "../src/lib/auth";
import { db } from "../src/db/client";
import { user, session } from "../src/db/schema";
import { getActiveUser } from "../src/lib/active-user";
import { mayCreateApp } from "../src/lib/access";
import { PATCH as setCreatorPermission } from "../src/app/api/admin/creator-permission/route";

const base = "http://localhost:3000";
const email = "t01-worker-" + (process.env.GITHUB_RUN_ID ?? "local") + "@example.test";
const password = "Fixture-only-strong-password-1234!";
const adminEmail = "t01-admin@example.test";
const adminPassword = "CI-only-changed-admin-password-not-a-real-secret-456!";
const commonHeaders = { "x-test-client-ip": "10.23.0.2", "content-type": "application/json", origin: base };

function cookieOf(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Session cookie missing");
  const token = setCookie.split(",").find(part => part.includes("session_token")) ?? setCookie;
  return token.trim().split(";")[0];
}
async function call(method: string, path: string, body?: unknown, cookie?: string) {
  return auth.handler(new Request(base + path, {
    method,
    headers: { ...commonHeaders, ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
async function grant(userId: string, canCreateApp: boolean, cookie?: string) {
  return setCreatorPermission(new Request(base + "/api/admin/creator-permission", {
    method: "PATCH",
    headers: { ...commonHeaders, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ userId, canCreateApp }),
  }));
}

afterAll(async () => {
  const [found] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (found) await db.delete(user).where(eq(user.id, found.id));
});

describe("Better Auth admin, session and business rights integration", () => {
  it("rejects unauthenticated public sign-up and unauthorized permission changes", async () => {
    const rejected = await call("POST", "/api/auth/sign-up/email",
      { name: "Untrusted", email: "blocked-public@example.test", password });
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(await db.select({ id: user.id }).from(user)
      .where(eq(user.email, "blocked-public@example.test"))).toHaveLength(0);
    expect((await grant("unknown", true)).status).toBe(401);
  });

  it("creates an employee as admin and rejects the employee's direct privilege escalation", async () => {
    const adminLogin = await call("POST", "/api/auth/sign-in/email",
      { email: adminEmail, password: adminPassword });
    expect(adminLogin.status).toBe(200);
    const adminCookie = cookieOf(adminLogin);
    const adminHeaders = new Headers({ cookie: adminCookie });

    const created = await auth.api.createUser({ headers: adminHeaders, body: {
      name: "T01 Worker", email, password, role: "user",
    } });
    expect(created.user.email).toBe(email);

    const employeeLogin = await call("POST", "/api/auth/sign-in/email", { email, password });
    expect(employeeLogin.status).toBe(200);
    const changed = await call("POST", "/api/auth/change-password", { currentPassword: password, newPassword: password + "-personal" }, cookieOf(employeeLogin));
    expect(changed.status).toBe(200);
    const employeeCookie = cookieOf(changed);
    const employeeHeaders = new Headers({ cookie: employeeCookie });

    expect((await getActiveUser(employeeHeaders))?.email).toBe(email);
    expect((await grant(created.user.id, true, employeeCookie)).status).toBe(403);
    expect(mayCreateApp((await getActiveUser(employeeHeaders))!)).toBe(false);

    expect((await grant(created.user.id, true, adminCookie)).status).toBe(200);
    expect(mayCreateApp((await getActiveUser(employeeHeaders))!)).toBe(true);
    expect((await grant(created.user.id, false, adminCookie)).status).toBe(200);
    expect(mayCreateApp((await getActiveUser(employeeHeaders))!)).toBe(false);

    await auth.api.banUser({
      headers: adminHeaders,
      body: { userId: created.user.id, banReason: "CI auth boundary test" },
    });
    expect(await getActiveUser(employeeHeaders)).toBeNull();
    const bannedLogin = await call("POST", "/api/auth/sign-in/email", { email, password: password + "-personal" });
    expect(bannedLogin.status).toBeGreaterThanOrEqual(400);

    await auth.api.unbanUser({ headers: adminHeaders, body: { userId: created.user.id } });
    const resumed = await call("POST", "/api/auth/sign-in/email", { email, password: password + "-personal" });
    expect(resumed.status).toBe(200);
    const newCookie = cookieOf(resumed);

    const signedOut = await call("POST", "/api/auth/sign-out", undefined, newCookie);
    expect(signedOut.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: newCookie }) })).toBeNull();
    const remaining = await db.select({ token: session.token }).from(session)
      .where(eq(session.userId, created.user.id));
    expect(remaining).toHaveLength(0);
  });
});
