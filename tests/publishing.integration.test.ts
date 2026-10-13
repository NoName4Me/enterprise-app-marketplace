import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "../src/lib/auth";
import { db } from "../src/db/client";
import { appRevisions, applications, reviewEvents, user } from "../src/db/schema";
import { GET as publicList } from "../src/app/api/apps/route";
import { GET as publicDetail } from "../src/app/api/apps/[id]/route";
import { GET as ownDetail, PATCH as editApp } from "../src/app/api/my/apps/[id]/route";
import { POST as createApp } from "../src/app/api/my/apps/route";
import { POST as submitApp } from "../src/app/api/my/apps/[id]/submit/route";
import { POST as newDraft } from "../src/app/api/my/apps/[id]/draft/route";
import { POST as review } from "../src/app/api/admin/reviews/[id]/[action]/route";

const base = "http://localhost:3000";
const prefix = "t02-" + (process.env.GITHUB_RUN_ID ?? "local");
const password = "CI-fixture-strong-password-345678!";
const appIds: string[] = [];
const userIds: string[] = [];
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

function request(method: string, route: string, cookie?: string, body?: unknown) {
  return new Request(base + route, {
    method,
    headers: {
      origin: base, "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function ctx(id: string, action?: string) {
  return { params: Promise.resolve({ id, action: action ?? "" }) };
}
function cookieFrom(response: Response) {
  const header = response.headers.get("set-cookie");
  if (!header) throw new Error("Expected authentication cookie");
  return (header.split(",").find(x => x.includes("session_token")) ?? header)
    .trim().split(";")[0];
}
async function login(email: string, secret: string) {
  const response = await auth.handler(request("POST", "/api/auth/sign-in/email", undefined, {
    email, password: secret,
  }));
  expect(response.status).toBe(200);
  return cookieFrom(response);
}
async function createFixture(role: string, label: string) {
  const email = prefix + "-" + label + "@example.test";
  const created = await auth.api.createUser({
    headers: new Headers({ cookie: cookies.admin }),
    body: { email, name: label, password, role },
  });
  userIds.push(created.user.id);
  ids[label] = created.user.id;
  cookies[label] = await login(email, password);
  return created.user.id;
}
async function createAs(label: string, content: Record<string, unknown>) {
  const response = await createApp(request("POST", "/api/my/apps", cookies[label], content));
  expect(response.status).toBe(201);
  const result = await response.json();
  appIds.push(result.id);
  return result as { id: string; revisionId: string; status: string };
}
const draftContent = {
  name: "内部报表中心", summary: "业务报表检索", description: "提供已批准的报表链接",
  category: "analytics", targetUrl: "https://example.test/reports-v1",
};

beforeAll(async () => {
  cookies.admin = await login("t01-admin@example.test", "CI-only-test-password-not-a-real-secret-123!");
  await createFixture("user", "alice");
  await createFixture("user", "bob");
  await createFixture("user", "carol");
  await createFixture("admin", "reviewer");
  await db.update(user).set({ canCreateApp: true }).where(eq(user.id, ids.bob));
  await db.update(user).set({ canCreateApp: true }).where(eq(user.id, ids.carol));
}, 30000);

afterAll(async () => {
  await db.execute(sql`DROP TRIGGER IF EXISTS t02_reject_review_event ON review_events`);
  await db.execute(sql`DROP FUNCTION IF EXISTS t02_fail_review_event()`);
  for (const id of appIds) await db.delete(applications).where(eq(applications.id, id));
  for (const id of userIds) await db.delete(user).where(eq(user.id, id));
}, 30000);

describe.sequential("T02 published revision and approval invariants", () => {
  it("requires real identity and prevents privilege spoofing and bad URLs", async () => {
    expect((await publicList(request("GET", "/api/apps"))).status).toBe(401);
    expect((await createApp(request("POST", "/api/my/apps", cookies.alice, draftContent))).status).toBe(403);
    const forged = await createApp(request("POST", "/api/my/apps", cookies.bob, {
      ...draftContent, ownerUserId: ids.alice, status: "APPROVED",
    }));
    expect(forged.status).toBe(422);
    for (const targetUrl of ["javascript:alert(1)", "data:text/html,hello", "http://insecure.test", "https://example.test/#fragment"]) {
      expect((await createApp(request("POST", "/api/my/apps", cookies.bob,
        { ...draftContent, targetUrl }))).status).toBe(422);
    }
  });

  it("does not publish drafts or pending changes; approves exactly one snapshot", async () => {
    const app = await createAs("bob", { name: "草稿", category: "analytics" });
    const incomplete = await submitApp(request("POST", "/api/my/apps/" + app.id + "/submit", cookies.bob), ctx(app.id));
    expect(incomplete.status).toBe(422);

    const saved = await editApp(request("PATCH", "/api/my/apps/" + app.id, cookies.bob, draftContent), ctx(app.id));
    expect(saved.status).toBe(200);
    expect((await publicDetail(request("GET", "/api/apps/" + app.id, cookies.alice), ctx(app.id))).status).toBe(404);
    const submitted = await submitApp(request("POST", "/api/my/apps/" + app.id + "/submit", cookies.bob), ctx(app.id));
    expect(submitted.status).toBe(200);
    expect((await editApp(request("PATCH", "/api/my/apps/" + app.id, cookies.bob, { name: "绕过审批" }), ctx(app.id))).status).toBe(409);
    expect((await publicList(request("GET", "/api/apps?q=报表", cookies.alice))).status).toBe(200);
    expect(await (await publicList(request("GET", "/api/apps?q=报表", cookies.alice))).json()).toEqual([]);

    expect((await review(request("POST", "/api/admin/reviews/" + app.revisionId + "/approve", cookies.bob),
      ctx(app.revisionId, "approve"))).status).toBe(403);
    expect((await review(request("POST", "/api/admin/reviews/" + app.revisionId + "/approve", cookies.admin),
      ctx(app.revisionId, "approve"))).status).toBe(200);
    const detail = await publicDetail(request("GET", "/api/apps/" + app.id, cookies.alice), ctx(app.id));
    expect(detail.status).toBe(200);
    const data = await detail.json();
    expect(data.name).toBe(draftContent.name);
    expect(data.targetUrl).toBe(draftContent.targetUrl);
    expect(data).not.toHaveProperty("rejectionReason");
    expect(data).not.toHaveProperty("createdBy");
    const [stored] = await db.select().from(applications).where(eq(applications.id, app.id));
    expect(stored.listingStatus).toBe("LISTED");
    expect(stored.publishedRevisionId).toBe(app.revisionId);
    expect((await review(request("POST", "/api/admin/reviews/" + app.revisionId + "/approve", cookies.admin),
      ctx(app.revisionId, "approve"))).status).toBe(409);

    // New draft/update keeps the old published version visible until accepted.
    const update = await newDraft(request("POST", "/api/my/apps/" + app.id + "/draft", cookies.bob), ctx(app.id));
    expect(update.status).toBe(201);
    const next = await update.json();
    expect((await newDraft(request("POST", "/api/my/apps/" + app.id + "/draft", cookies.bob), ctx(app.id))).status).toBe(409);
    await editApp(request("PATCH", "/api/my/apps/" + app.id, cookies.bob, {
      name: "新版报表中心", targetUrl: "https://example.test/reports-v2",
    }), ctx(app.id));
    expect((await submitApp(request("POST", "/api/my/apps/" + app.id + "/submit", cookies.bob), ctx(app.id))).status).toBe(200);
    expect((await (await publicDetail(request("GET", "/api/apps/" + app.id, cookies.alice), ctx(app.id))).json()).targetUrl).toBe(draftContent.targetUrl);
    expect((await review(request("POST", "/api/admin/reviews/" + next.revisionId + "/approve", cookies.admin),
      ctx(next.revisionId, "approve"))).status).toBe(200);
    expect((await (await publicDetail(request("GET", "/api/apps/" + app.id, cookies.alice), ctx(app.id))).json()).targetUrl).toBe("https://example.test/reports-v2");
  });

  it("rejects missing reason and creates fresh draft after rejection", async () => {
    const app = await createAs("bob", draftContent);
    await submitApp(request("POST", "/api/my/apps/" + app.id + "/submit", cookies.bob), ctx(app.id));
    expect((await review(request("POST", "/api/admin/reviews/" + app.revisionId + "/reject", cookies.admin, { reason: "" }),
      ctx(app.revisionId, "reject"))).status).toBe(422);
    expect((await review(request("POST", "/api/admin/reviews/" + app.revisionId + "/reject", cookies.admin, { reason: "信息需要完善" }),
      ctx(app.revisionId, "reject"))).status).toBe(200);
    expect((await publicDetail(request("GET", "/api/apps/" + app.id, cookies.alice), ctx(app.id))).status).toBe(404);
    const own = await ownDetail(request("GET", "/api/my/apps/" + app.id, cookies.bob), ctx(app.id));
    expect((await own.json()).revisions[0].rejectionReason).toBe("信息需要完善");
    const reopened = await newDraft(request("POST", "/api/my/apps/" + app.id + "/draft", cookies.bob), ctx(app.id));
    expect(reopened.status).toBe(201);
    const newRevision = await reopened.json();
    expect(newRevision.revisionId).not.toBe(app.revisionId);
    expect(newRevision.sequence).toBe(2);
    const old = await db.select().from(appRevisions).where(eq(appRevisions.id, app.revisionId));
    expect(old[0].status).toBe("REJECTED");
  });

  it("prevents IDOR and enforces immediate permission revocation", async () => {
    const app = await createAs("carol", draftContent);
    expect((await editApp(request("PATCH", "/api/my/apps/" + app.id, cookies.bob, { name: "夺权" }), ctx(app.id))).status).toBe(404);
    expect((await ownDetail(request("GET", "/api/my/apps/" + app.id, cookies.bob), ctx(app.id))).status).toBe(404);
    await db.update(user).set({ canCreateApp: false }).where(eq(user.id, ids.carol));
    expect((await submitApp(request("POST", "/api/my/apps/" + app.id + "/submit", cookies.carol), ctx(app.id))).status).toBe(403);
    await db.update(user).set({ canCreateApp: true }).where(eq(user.id, ids.carol));
  });

  it("serializes concurrent approval and rejection, writing one terminal event", async () => {
    const app = await createAs("bob", draftContent);
    await submitApp(request("POST", "/api/my/apps/" + app.id + "/submit", cookies.bob), ctx(app.id));
    const [a,b] = await Promise.all([
      review(request("POST", "/api/admin/reviews/" + app.revisionId + "/approve", cookies.admin),ctx(app.revisionId,"approve")),
      review(request("POST", "/api/admin/reviews/" + app.revisionId + "/reject", cookies.reviewer,{ reason:"并发驳回" }),ctx(app.revisionId,"reject")),
    ]);
    expect([a.status,b.status].sort()).toEqual([200,409]);
    const events = await db.select().from(reviewEvents).where(eq(reviewEvents.revisionId,app.revisionId));
    expect(events.filter(e=>e.action!=="SUBMITTED")).toHaveLength(1);
  });

  it("rolls back approval state and public pointer if audit insert fails", async () => {
    const app = await createAs("bob", draftContent);
    await submitApp(request("POST", "/api/my/apps/" + app.id + "/submit", cookies.bob),ctx(app.id));
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION t02_fail_review_event() RETURNS trigger AS $$
      BEGIN IF NEW.action = 'APPROVED' THEN RAISE EXCEPTION 'forced T02 audit rollback'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql
    `);
    await db.execute(sql`
      CREATE TRIGGER t02_reject_review_event BEFORE INSERT ON review_events
      FOR EACH ROW EXECUTE FUNCTION t02_fail_review_event()
    `);
    try {
      const response = await review(
        request("POST", "/api/admin/reviews/" + app.revisionId + "/approve", cookies.admin),
        ctx(app.revisionId,"approve"),
      );
      expect(response.status).toBe(500);
      const [application] = await db.select().from(applications).where(eq(applications.id,app.id));
      const [revision] = await db.select().from(appRevisions).where(eq(appRevisions.id,app.revisionId));
      expect(application.publishedRevisionId).toBeNull();
      expect(application.listingStatus).toBe("UNLISTED");
      expect(revision.status).toBe("PENDING");
      expect((await db.select().from(reviewEvents).where(and(
        eq(reviewEvents.revisionId,app.revisionId),eq(reviewEvents.action,"APPROVED")
      )))).toHaveLength(0);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS t02_reject_review_event ON review_events`);
      await db.execute(sql`DROP FUNCTION IF EXISTS t02_fail_review_event()`);
    }
  });
});
