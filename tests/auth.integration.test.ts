import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "../src/lib/auth";
import { db } from "../src/db/client";
import { user, session } from "../src/db/schema";
import { getActiveUser } from "../src/lib/active-user";
import { mayCreateApp } from "../src/lib/access";

const base = "http://localhost:3000";
const email = "t01-worker-" + process.env.GITHUB_RUN_ID + "@example.test";
const password = "Fixture-only-strong-password-1234!";
const cookieHeaders = { "content-type": "application/json", origin: base };

function cookieOf(response: Response) {
  const header = response.headers.get("set-cookie");
  if (!header) throw new Error("Expected Better Auth session cookie");
  return header.split(";")[0];
}

async function request(method: string, path: string, body?: unknown, cookie?: string) {
  return auth.handler(new Request(base + path, {
    method,
    headers: { ...cookieHeaders, ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

afterAll(async () => {
  const [record] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (record) await db.delete(user).where(eq(user.id, record.id));
});

describe("real Better Auth session lifecycle", () => {
  it("rejects anonymous registration", async () => {
    const response = await request("POST", "/api/auth/sign-up/email",
      { name: "Untrusted", email: "public-blocked@example.test", password });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await db.select({ id: user.id }).from(user).where(eq(user.email, "public-blocked@example.test"))).toHaveLength(0);
  });

  it("provisions staff through the admin server API, signs in, observes live role changes and signs out", async () => {
    const administrator = await request("POST", "/api/auth/sign-in/email", {
      email: "t01-admin@example.test",
      password: "CI-only-test-password-not-a-real-secret-123!",
    });
    expect(administrator.status).toBe(200);
    const adminCookie = cookieOf(administrator);
    const created = await auth.api.createUser({ headers: new Headers({ cookie: adminCookie }), body: {
      name: "T01 Worker", email, password, role: "user",
    } });
    expect(created.user.email).toBe(email);
    const signedIn = await request("POST", "/api/auth/sign-in/email", { email, password });
    expect(signedIn.status).toBe(200);
    const cookie = cookieOf(signedIn);
    const headers = new Headers({ cookie });

    const current = await getActiveUser(headers);
    expect(current?.email).toBe(email);
    expect(mayCreateApp(current!)).toBe(false);

    await db.update(user).set({ canCreateApp: true }).where(eq(user.id, created.user.id));
    expect(mayCreateApp((await getActiveUser(headers))!)).toBe(true);

    await db.update(user).set({ banned: true }).where(eq(user.id, created.user.id));
    expect(await getActiveUser(headers)).toBeNull();

    await db.update(user).set({ banned: false }).where(eq(user.id, created.user.id));
    const signedOut = await request("POST", "/api/auth/sign-out", undefined, cookie);
    expect(signedOut.status).toBe(200);
    expect(await auth.api.getSession({ headers })).toBeNull();

    const rows = await db.select({ token: session.token }).from(session)
      .where(eq(session.userId, created.user.id));
    expect(rows).toHaveLength(0);
  });
});
