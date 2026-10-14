import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "../src/lib/auth";
import { db } from "../src/db/client";
import { applications, appRevisions, appAccessRequests, user } from "../src/db/schema";
import { POST as create } from "../src/app/api/apps/[id]/access-requests/route";
import { POST as decide } from "../src/app/api/access-requests/[id]/decision/route";
import { POST as provision } from "../src/app/api/access-requests/[id]/provision/route";
import { listMyAccessRequests, listAccessInbox } from "../src/domain/access-request-service";

const base = "http://localhost:3000";
const secret = "CI-p2-fixture-strong-password-123456!";
const suffix = Date.now().toString();
const ids: Record<string, string> = {};
const cookies: Record<string, string> = {};
let appId: string;
function req(method: string, cookie?: string, body?: unknown) {
  return new Request(base + "/api/access-requests", {
    method, headers: { origin: base, "content-type": "application/json",
      "x-test-client-ip": "10.23.0.81", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function sessionCookie(response: Response) {
  const text = response.headers.get("set-cookie");
  if (!text) throw new Error("Expected login cookie");
  return (text.split(",").find(s => s.includes("session_token")) ?? text).trim().split(";")[0];
}
async function login(email: string, password: string) {
  const response = await auth.handler(new Request(base + "/api/auth/sign-in/email", {
    method: "POST", headers: { origin: base, "content-type": "application/json",
      "x-test-client-ip": "10.23.0.81" }, body: JSON.stringify({ email, password }),
  }));
  expect(response.status).toBe(200);
  return sessionCookie(response);
}
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/market_test")
    throw new Error("P2 test only runs on isolated market_test");
  cookies.admin = await login("t01-admin@example.test", "CI-only-changed-admin-password-not-a-real-secret-456!");
  for (const label of ["owner", "employee", "other"]) {
    const email = `p2-${suffix}-${label}@example.test`;
    const result = await auth.api.createUser({
      headers: new Headers({ cookie: cookies.admin }),
      body: { email, name: label, password: secret, role: "user" },
    });
    ids[label] = result.user.id;
    let cookie = await login(email, secret);
    const changed = await auth.handler(new Request(base + "/api/auth/change-password", {
      method: "POST", headers: { origin: base, cookie, "content-type": "application/json",
        "x-test-client-ip": "10.23.0.81" }, body: JSON.stringify({
        currentPassword: secret, newPassword: secret + "-personal",
      }),
    }));
    expect(changed.status).toBe(200);
    cookie = sessionCookie(changed);
    cookies[label] = cookie;
  }
  await db.update(user).set({ canCreateApp: true }).where(eq(user.id, ids.owner));
  const [app] = await db.insert(applications).values({ ownerUserId: ids.owner }).returning({ id: applications.id });
  appId = app.id;
  const [revision] = await db.insert(appRevisions).values({
    appId, sequence: 1, status: "APPROVED", name: "访问申请测试应用",
    targetUrl: "https://example.test/app", createdBy: ids.owner,
  }).returning({ id: appRevisions.id });
  await db.update(applications).set({ listingStatus: "LISTED", publishedRevisionId: revision.id })
    .where(eq(applications.id, appId));
}, 30000);
afterAll(async () => {
  if (appId) {
    await db.delete(appAccessRequests).where(eq(appAccessRequests.appId, appId));
    await db.delete(applications).where(eq(applications.id, appId));
  }
  for (const label of ["owner", "employee", "other"])
    if (ids[label]) await db.delete(user).where(eq(user.id, ids[label]));
}, 30000);

describe.sequential("P2 application access main flow and authorization", () => {
  it("employee applies, owner decides, manual processing is recorded but not verified", async () => {
    const result = await create(req("POST", cookies.employee, { reason: "需要使用这个应用生成报表" }), ctx(appId));
    expect(result.status).toBe(201);
    const { id } = await result.json();
    expect((await create(req("POST", cookies.employee, { reason: "第二份重复申请" }), ctx(appId))).status).toBe(409);
    expect((await decide(req("POST", cookies.employee, { action: "approve" }), ctx(id))).status).toBe(403);
    expect((await decide(req("POST", cookies.other, { action: "approve" }), ctx(id))).status).toBe(403);
    expect((await listAccessInbox({ id: ids.owner })).map(x => x.id)).toContain(id);
    expect((await decide(req("POST", cookies.owner, { action: "approve" }), ctx(id))).status).toBe(200);
    expect((await decide(req("POST", cookies.owner, { action: "reject", reason: "再尝试重复审批" }), ctx(id))).status).toBe(409);
    const [approved] = await listMyAccessRequests({ id: ids.employee });
    expect(approved).toMatchObject({ id, status: "APPROVED", provisioningStatus: "PENDING" });
    expect((await provision(req("POST", cookies.employee, { note: "自己标记已开通" }), ctx(id))).status).toBe(403);
    expect((await provision(req("POST", cookies.owner, { note: "已经通知系统管理员手动开通" }), ctx(id))).status).toBe(200);
    const [finished] = await listMyAccessRequests({ id: ids.employee });
    expect(finished).toMatchObject({ id, status: "APPROVED", provisioningStatus: "MANUAL_RECORDED" });
  });
  it("self-approval is refused; a different admin may handle owner requests", async () => {
    const response = await create(req("POST", cookies.owner, { reason: "本人请求使用负责的应用" }), ctx(appId));
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect((await decide(req("POST", cookies.owner, { action: "approve" }), ctx(id))).status).toBe(403);
    expect((await decide(req("POST", cookies.admin, { action: "approve" }), ctx(id))).status).toBe(200);
    expect((await provision(req("POST", cookies.owner, { note: "自己声称已开通" }), ctx(id))).status).toBe(403);
    expect((await provision(req("POST", cookies.admin, { note: "人工记录并通知负责人确认" }), ctx(id))).status).toBe(200);
  });
});
