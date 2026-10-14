import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "../src/lib/auth";
import { db } from "../src/db/client";
import { applications, appComponents, appEnvironments, componentEnvironments, externalReferences, assetEvents, user, appRevisions } from "../src/db/schema";
import { GET as getAssets, PATCH as patchTeam } from "../src/app/api/my/apps/[id]/assets/route";
import { POST as postAsset } from "../src/app/api/my/apps/[id]/assets/[resource]/route";
import { PATCH as patchAsset } from "../src/app/api/my/apps/[id]/assets/[resource]/[resourceId]/route";
import { GET as adminAssets } from "../src/app/api/admin/apps/[id]/assets/route";
import { GET as getEvents } from "../src/app/api/my/apps/[id]/asset-events/route";
import { GET as adminEvents } from "../src/app/api/admin/apps/[id]/asset-events/route";
import { GET as publicDetail } from "../src/app/api/apps/[id]/route";
import { GET as publicList } from "../src/app/api/apps/route";
import { POST as createApp } from "../src/app/api/my/apps/route";
import { createAsset } from "../src/domain/asset-service";

const base = "http://localhost:3000";
const prefix = "p1-" + Date.now();
const secret = "CI-fixture-asset-password-345678!";
const ids: Record<string, string> = {};
const cookies: Record<string, string> = {};
const apps: string[] = [];
const users: string[] = [];
function request(method: string, cookie?: string, body?: unknown, origin = base) {
  return new Request(base + "/api/my/apps", { method, headers: { origin, "content-type": "application/json", "x-test-client-ip": "10.23.0.51", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function context(id: string, resource = "components", resourceId = "") { return { params: Promise.resolve({ id, resource, resourceId }) }; }
function cookie(response: Response) {
  const header = response.headers.get("set-cookie");
  if (!header) throw new Error("No authentication cookie");
  return (header.split(",").find(x => x.includes("session_token")) ?? header).trim().split(";")[0];
}
async function login(email: string, password: string) {
  const response = await auth.handler(new Request(base + "/api/auth/sign-in/email", { method: "POST", headers: { origin: base, "content-type": "application/json", "x-test-client-ip": "10.23.0.51" }, body: JSON.stringify({ email, password }) }));
  expect(response.status).toBe(200); return cookie(response);
}
async function app(label = "owner") {
  const response = await createApp(request("POST", cookies[label], { name: "资产测试", category: "other" }));
  expect(response.status).toBe(201); const data = await response.json(); apps.push(data.id); return data.id as string;
}
async function read(id: string, label = "owner") {
  const response = await getAssets(request("GET", cookies[label]), context(id));
  expect(response.status).toBe(200); return response.json();
}
async function version(id: string) { return (await read(id)).assetVersion as number; }
async function create(id: string, resource: string, fields: Record<string, unknown>, status = 201) {
  const response = await postAsset(request("POST", cookies.owner, { expectedVersion: await version(id), ...fields }), context(id, resource));
  expect(response.status).toBe(status); return response.json();
}
async function patch(id: string, resource: string, resourceId: string, fields: Record<string, unknown>, status = 200) {
  const response = await patchAsset(request("PATCH", cookies.owner, { expectedVersion: await version(id), ...fields }), context(id, resource, resourceId));
  expect(response.status).toBe(status); return response.json();
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname !== "/market_test") throw new Error("Assets tests require isolated market_test DB");
  cookies.admin = await login("t01-admin@example.test", "CI-only-changed-admin-password-not-a-real-secret-456!");
  for (const label of ["owner", "other", "employee", "first", "disabled", "adminOwner"]) {
    const email = `${prefix}-${label.toLowerCase()}@example.test`;
    const result = await auth.api.createUser({ headers: new Headers({ cookie: cookies.admin }), body: { email, name: label, password: secret, role: label === "adminOwner" ? "admin" : "user" } });
    ids[label] = result.user.id; users.push(result.user.id);
    cookies[label] = await login(email, secret);
    if (label !== "first") {
      const changed = await auth.handler(new Request(base + "/api/auth/change-password", { method: "POST", headers: { cookie: cookies[label], origin: base, "content-type": "application/json", "x-test-client-ip": "10.23.0.51" }, body: JSON.stringify({ currentPassword: secret, newPassword: secret + "-personal" }) }));
      expect(changed.status).toBe(200); cookies[label] = cookie(changed);
    }
  }
  for (const label of ["owner", "other", "adminOwner"]) await db.update(user).set({ canCreateApp: true }).where(eq(user.id, ids[label]));
  await db.update(user).set({ banned: true }).where(eq(user.id, ids.disabled));
}, 60000);
afterAll(async () => {
  await db.execute(sql`DROP TRIGGER IF EXISTS p1_fail_audit ON asset_events`);
  await db.execute(sql`DROP FUNCTION IF EXISTS p1_fail_audit()`);
  for (const id of apps) {
    for (const table of [assetEvents, externalReferences, componentEnvironments, appEnvironments, appComponents]) await db.delete(table).where(eq(table.appId, id));
    await db.delete(applications).where(eq(applications.id, id));
  }
  for (const id of users) await db.delete(user).where(eq(user.id, id));
}, 30000);

describe.sequential("P1-A private asset registration on real PostgreSQL", () => {
  it("registers explicit combinations and typed GitHub objects without runtime claims", async () => {
    const id = await app();
    const components: { id: string }[] = [];
    for (const key of ["portal", "api"]) components.push((await create(id, "components", { key, name: key })).resource);
    const environments: { id: string }[] = [];
    for (const key of ["test", "prod"]) environments.push((await create(id, "environments", { key, name: key, purpose: key === "prod" ? "PRODUCTION" : "TEST" })).resource);
    for (const [c, e] of [[0, 0], [0, 1], [1, 0]]) await create(id, "bindings", { componentId: components[c].id, environmentId: environments[e].id });
    const registered = await read(id);
    expect(registered.bindings).toHaveLength(3);
    const ref = (await create(id, "references", { componentId: components[0].id, bindingId: registered.bindings.find((binding: { componentId: string }) => binding.componentId === components[0].id).id, resourceKind: "WORKFLOW", repositoryFullName: "Example/Portal", workflowId: "12345" })).resource;
    expect(ref.repositoryFullName).toBe("example/portal");
    const aggregate = await read(id);
    expect(aggregate.assetVersion).toBe(9); expect(aggregate.lifecycleStatus).toBe("UNKNOWN");
    expect(aggregate.references[0]).toMatchObject({ connectionStatus: "NOT_VERIFIED", lastCollectedAt: null, url: "https://github.com/example/portal/actions" });
    expect(aggregate.healthStatus).toBe("NOT_CONNECTED"); expect(aggregate.deploymentStatus).toBe("NOT_CONNECTED");
    expect((await db.select().from(appRevisions).where(eq(appRevisions.appId, id)))[0].status).toBe("DRAFT");
  });
  it("rejects every non-owner, inactive identity and cross-origin write without leaking data", async () => {
    const id = await app();
    for (const [label, status] of [[undefined, 401], ["employee", 404], ["other", 404], ["admin", 404], ["first", 403], ["disabled", 401]] as const) {
      expect((await getAssets(request("GET", label && cookies[label]), context(id))).status).toBe(status);
      expect((await getEvents(request("GET", label && cookies[label]), context(id))).status).toBe(status);
      const response = await postAsset(request("POST", label && cookies[label], { expectedVersion: 1, key: "api", name: "private" }), context(id));
      expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.text()).not.toContain("private");
    }
    expect((await postAsset(request("POST", cookies.owner, { expectedVersion: 1, key: "api", name: "api" }, "https://attacker.test"), context(id))).status).toBe(403);
    expect((await postAsset(request("POST", cookies.owner, { expectedVersion: 1, key: "api", name: "api" }, ""), context(id))).status).toBe(403);
    expect(await version(id)).toBe(1);
    expect((await adminAssets(request("GET", cookies.admin), context(id))).status).toBe(200);
    expect((await adminEvents(request("GET", cookies.admin), context(id))).status).toBe(200);
    expect((await adminAssets(request("GET", cookies.owner), context(id))).status).toBe(403);
  });
  it("checks current creator permission including administrators, while preserving owner read", async () => {
    for (const label of ["owner", "adminOwner"]) {
      const id = await app(label);
      await db.update(user).set({ canCreateApp: false }).where(eq(user.id, ids[label]));
      try {
        expect((await getAssets(request("GET", cookies[label]), context(id))).status).toBe(200);
        expect((await postAsset(request("POST", cookies[label], { expectedVersion: 1, key: "api", name: "api" }), context(id))).status).toBe(403);
        expect((await patchTeam(request("PATCH", cookies[label], { expectedVersion: 1, responsibleTeamName: "Team" }), context(id))).status).toBe(403);
      } finally { await db.update(user).set({ canCreateApp: true }).where(eq(user.id, ids[label])); }
    }
  });
  it("rejects cross-app IDs and wrong-component binding references in API and DB constraints", async () => {
    const a = await app(), b = await app();
    const c = (await create(a, "components", { key: "a", name: "A" })).resource;
    const d = (await create(a, "components", { key: "d", name: "D" })).resource;
    const e = (await create(b, "environments", { key: "b", name: "B", purpose: "TEST" })).resource;
    const f = (await create(a, "environments", { key: "a", name: "A", purpose: "TEST" })).resource;
    const binding = (await create(a, "bindings", { componentId: c.id, environmentId: f.id })).resource;
    await create(a, "bindings", { componentId: c.id, environmentId: e.id }, 404);
    await create(a, "references", { componentId: d.id, bindingId: binding.id, resourceKind: "REPOSITORY", repositoryFullName: "example/portal" }, 404);
    await patch(b, "components", c.id, { name: "hijack" }, 404);
    await expect(db.insert(componentEnvironments).values({ appId: a, componentId: c.id, environmentId: e.id })).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(db.insert(externalReferences).values({ appId: a, componentId: d.id, bindingId: binding.id, resourceKind: "REPOSITORY", repositoryFullName: "example/portal" })).rejects.toMatchObject({ cause: { code: "23503" } });
  });
  it("keeps unique identities across nullable references and archive history", async () => {
    const id = await app(), second = await app();
    const c = (await create(id, "components", { key: "api", name: "API" })).resource;
    await create(second, "components", { key: "api", name: "API" });
    await create(id, "components", { key: "api", name: "Duplicate" }, 409);
    const ref = { componentId: c.id, resourceKind: "REPOSITORY", repositoryFullName: "Example/Portal" };
    const r = (await create(id, "references", ref)).resource;
    await create(id, "references", { ...ref, repositoryFullName: "example/portal", bindingId: null, workflowId: null }, 409);
    await expect(db.insert(externalReferences).values({ appId: id, ...ref, resourceKind: "REPOSITORY", repositoryFullName: "example/portal" })).rejects.toMatchObject({ cause: { code: "23505" } });
    await patch(id, "references", r.id, { archived: true });
    await patch(id, "components", c.id, { archived: true });
    await create(id, "components", { key: "api", name: "Duplicate" }, 409);
    await patch(id, "components", c.id, { archived: false });
    await create(id, "references", ref, 409);
    await patch(id, "references", r.id, { archived: false });
    expect((await read(id)).references[0].id).toBe(r.id);
  });
  it("enforces dependency archive and restore order and immutable relationship IDs", async () => {
    const id = await app();
    const c = (await create(id, "components", { key: "api", name: "API" })).resource;
    const e = (await create(id, "environments", { key: "test", name: "Test", purpose: "TEST" })).resource;
    const b = (await create(id, "bindings", { componentId: c.id, environmentId: e.id })).resource;
    await create(id, "bindings", { componentId: c.id, environmentId: e.id }, 409);
    const r = (await create(id, "references", { componentId: c.id, bindingId: b.id, resourceKind: "WORKFLOW", repositoryFullName: "example/portal", workflowId: "1" })).resource;
    for (const [resource, object] of [["components", c], ["environments", e], ["bindings", b]] as const) await patch(id, resource, object.id, { archived: true }, 409);
    await patch(id, "bindings", b.id, { componentId: c.id }, 422);
    await patch(id, "references", r.id, { archived: true });
    await patch(id, "bindings", b.id, { archived: true });
    await patch(id, "components", c.id, { archived: true });
    await patch(id, "environments", e.id, { archived: true });
    await patch(id, "bindings", b.id, { archived: false }, 409);
    await patch(id, "references", r.id, { archived: false }, 409);
    await patch(id, "components", c.id, { name: "Change archived" }, 409);
    await patch(id, "components", c.id, { archived: false });
    await patch(id, "environments", e.id, { archived: false });
    await patch(id, "references", r.id, { archived: false }, 409);
    await patch(id, "bindings", b.id, { archived: false });
    await patch(id, "references", r.id, { archived: false });
    await patch(id, "components", c.id, { name: "New name", notes: "Private notes" });
  });
  it("serializes competing writes and records exactly one successful event/version", async () => {
    const id = await app();
    const results = await Promise.all(["first", "second"].map(key => postAsset(request("POST", cookies.owner, { expectedVersion: 1, key, name: key }), context(id))));
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await version(id)).toBe(2);
    expect((await read(id)).components).toHaveLength(1);
    const events = await (await getEvents(request("GET", cookies.owner), context(id))).json();
    expect(events.items).toHaveLength(1); expect(events.items[0].assetVersionAfter).toBe(2);
  });
  it("waits for permission revocation and then denies direct domain writes", async () => {
    const id = await app();
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const revoke = db.transaction(async tx => {
      await tx.update(user).set({ canCreateApp: false }).where(eq(user.id, ids.owner));
      locked(); await hold;
    });
    await ready;
    const pending = createAsset({ id: ids.owner }, id, "components", { expectedVersion: 1, key: "blocked", name: "Blocked" });
    // Attach rejection observer immediately and prove the write is waiting on the user lock.
    const assertion = expect(pending).rejects.toMatchObject({ status: 403 });
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await db.execute(sql`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%"user"%for share%'`);
        if (result.rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      release(); await revoke; await assertion; expect(await version(id)).toBe(1);
    }
    finally { release(); await db.update(user).set({ canCreateApp: true }).where(eq(user.id, ids.owner)); }
  });
  it("rolls back resource, version and audit on injected audit failure", async () => {
    const id = await app();
    await db.execute(sql`CREATE FUNCTION p1_fail_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END; $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER p1_fail_audit BEFORE INSERT ON asset_events FOR EACH ROW EXECUTE FUNCTION p1_fail_audit()`);
    try {
      const response = await postAsset(request("POST", cookies.owner, { expectedVersion: 1, key: "rollback", name: "Rollback" }), context(id));
      expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "internal_error" });
      expect(await version(id)).toBe(1); expect((await read(id)).components).toHaveLength(0);
      expect(await db.select().from(assetEvents).where(eq(assetEvents.appId, id))).toHaveLength(0);
    } finally { await db.execute(sql`DROP TRIGGER p1_fail_audit ON asset_events`); await db.execute(sql`DROP FUNCTION p1_fail_audit()`); }
  });
  it("keeps published snapshot projection unchanged with a pending update and private assets", async () => {
    const id = await app();
    const [approved] = await db.update(appRevisions).set({ status: "APPROVED", name: "Approved", targetUrl: "https://example.test/old" }).where(eq(appRevisions.appId, id)).returning();
    await db.update(applications).set({ listingStatus: "LISTED", publishedRevisionId: approved.id }).where(eq(applications.id, id));
    const before = await (await publicDetail(request("GET", cookies.employee), context(id))).json();
    const listBefore = await (await publicList(request("GET", cookies.employee))).json();
    await db.insert(appRevisions).values({ appId: id, sequence: 2, status: "PENDING", createdBy: ids.owner, name: "Private pending", targetUrl: "https://example.test/new" });
    await create(id, "components", { key: "secret", name: "Private component", notes: "Private note" });
    const response = await patchTeam(request("PATCH", cookies.owner, { expectedVersion: await version(id), responsibleTeamName: "Private team" }), context(id));
    expect(response.status).toBe(200);
    expect(await (await publicDetail(request("GET", cookies.employee), context(id))).json()).toEqual(before);
    expect(await (await publicList(request("GET", cookies.employee))).json()).toEqual(listBefore);
    const own = await getAssets(request("GET", cookies.owner), context(id));
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    const denied = await getAssets(request("GET", cookies.employee), context(id));
    expect(denied.status).toBe(404); expect(denied.headers.get("cache-control")).toContain("no-store");
    const events = await (await getEvents(request("GET", cookies.owner), context(id))).json();
    expect(JSON.stringify(events)).not.toContain("Private");
  });
  it("rejects sensitive fields, no-op changes, bad resource names and retains read-only retired assets", async () => {
    const id = await app();
    for (const field of ["owner", "actor", "status", "role", "publishedRevisionId", "assetVersion", "token"]) await create(id, "components", { key: "api", name: "API", [field]: "fake" }, 422);
    await create(id, "not-a-resource", { key: "api", name: "API" }, 404);
    await create(id, "components", { key: "api", name: "x".repeat(121) }, 422);
    const c = (await create(id, "components", { key: "api", name: "API" })).resource;
    await patch(id, "components", c.id, { name: "API" }, 409);
    await db.update(applications).set({ lifecycleStatus: "RETIRED" }).where(eq(applications.id, id));
    await create(id, "components", { key: "new", name: "New" }, 409);
    expect((await read(id)).components).toHaveLength(1);
    await expect(db.update(applications).set({ listingStatus: "LISTED", publishedRevisionId: crypto.randomUUID() }).where(eq(applications.id, id))).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("paginates private events with a stable version cursor and rejects malformed cursors", async () => {
    const id = await app();
    for (let i = 0; i < 51; i++) await create(id, "components", { key: "c" + i, name: "C" });
    const first = await (await getEvents(request("GET", cookies.owner), context(id))).json();
    expect(first.items).toHaveLength(50); expect(first.nextBeforeVersion).toBe(3);
    const req = new Request(base + "/api/my/apps/" + id + "/asset-events?beforeVersion=3", { headers: { cookie: cookies.owner } });
    const second = await (await getEvents(req, context(id))).json();
    expect(second.items).toHaveLength(1); expect(second.items[0].assetVersionAfter).toBe(2); expect(second.nextBeforeVersion).toBeNull();
    const bad = new Request(base + "/api/my/apps/" + id + "/asset-events?beforeVersion=NaN", { headers: { cookie: cookies.owner } });
    expect((await getEvents(bad, context(id))).status).toBe(422);
    expect(await db.select().from(assetEvents).where(and(eq(assetEvents.appId, id), eq(assetEvents.actorUserId, ids.owner)))).toHaveLength(51);
  });
});
