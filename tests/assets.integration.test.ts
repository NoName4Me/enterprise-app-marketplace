import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "../src/lib/auth";
import { db } from "../src/db/client";
import { applications, appComponents, appEnvironments, componentEnvironments, externalReferences, assetEvents, user, appRevisions, appFavorites } from "../src/db/schema";
import { GET as getAssets, PATCH as patchTeam } from "../src/app/api/my/apps/[id]/assets/route";
import { POST as postAsset } from "../src/app/api/my/apps/[id]/assets/[resource]/route";
import { PATCH as patchAsset } from "../src/app/api/my/apps/[id]/assets/[resource]/[resourceId]/route";
import { GET as adminAssets } from "../src/app/api/admin/apps/[id]/assets/route";
import { GET as getEvents } from "../src/app/api/my/apps/[id]/asset-events/route";
import { GET as adminEvents } from "../src/app/api/admin/apps/[id]/asset-events/route";
import { GET as publicDetail } from "../src/app/api/apps/[id]/route";
import { GET as publicList } from "../src/app/api/apps/route";
import { POST as createApp } from "../src/app/api/my/apps/route";
import { GET as publicCommunity } from "../src/app/api/apps/[id]/community/route";
import { matchScenarios } from "../src/domain/discovery";
import { createAsset } from "../src/domain/asset-service";

import { POST as lifeChange } from "../src/app/api/my/apps/[id]/lifecycle/transitions/route";
import { GET as preflight } from "../src/app/api/my/apps/[id]/lifecycle/preflight/route";
import { POST as adminLifeChange } from "../src/app/api/admin/apps/[id]/lifecycle/transitions/route";
import { POST as ownerTransfer } from "../src/app/api/admin/apps/[id]/owner-transfer/route";
import { editDraft, openNewDraft, submitDraft, reviewRevision } from "../src/domain/app-service";
import { manageListing } from "../src/domain/community-service";

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
    const communityBefore = await (await publicCommunity(request("GET", cookies.employee), context(id))).json();
    await db.insert(appFavorites).values({ appId: id, userId: ids.employee });
    const savedRequest = () => new Request(base + "/api/apps?saved=true", { headers: { cookie: cookies.employee } });
    const savedBefore = await (await publicList(savedRequest())).json();
    await db.insert(appRevisions).values({ appId: id, sequence: 2, status: "PENDING", createdBy: ids.owner, name: "Private pending", targetUrl: "https://example.test/new" });
    await create(id, "components", { key: "secret", name: "Private component", notes: "Private note" });
    const response = await patchTeam(request("PATCH", cookies.owner, { expectedVersion: await version(id), responsibleTeamName: "Private team" }), context(id));
    expect(response.status).toBe(200);
    expect(await (await publicDetail(request("GET", cookies.employee), context(id))).json()).toEqual(before);
    expect(await (await publicList(request("GET", cookies.employee))).json()).toEqual(listBefore.map((item: { id: string }) => item.id === id ? { ...item, saved: true, favorites: 1 } : item));
    expect(await (await publicList(savedRequest())).json()).toEqual(savedBefore);
    expect(await (await publicCommunity(request("GET", cookies.employee), context(id))).json()).toEqual({ ...communityBefore, saved: true });
    expect(matchScenarios("Private team", await (await publicList(savedRequest())).json())).toEqual([]);
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

async function lifecycle(id: string, to: string, label = "owner", admin = false, status = 200, expectedVersion?: number) {
  const [stored] = await db.select({ assetVersion: applications.assetVersion }).from(applications).where(eq(applications.id, id));
  const response = await (admin ? adminLifeChange : lifeChange)(request("POST", cookies[label], { expectedVersion: expectedVersion ?? stored.assetVersion, to, reason: "测试治理阶段", ...(to === "RETIRED" ? { impactAcknowledged: true } : {}) }), context(id));
  expect(response.status).toBe(status); return response.json();
}
async function readyForRetirement() {
  const id = await app();
  const [revision] = await db.update(appRevisions).set({ status: "APPROVED" }).where(eq(appRevisions.appId, id)).returning();
  await db.update(applications).set({ publishedRevisionId: revision.id, lifecycleStatus: "DEPRECATED" }).where(eq(applications.id, id));
  return { id, revision };
}
describe.sequential("P1-B lifecycle and owner governance", () => {
  it("keeps lifecycle independent of market approval and refuses skipped transitions", async () => {
    const id = await app();
    await lifecycle(id, "PILOT"); await lifecycle(id, "ACTIVE"); await lifecycle(id, "DEPRECATED");
    const [stored] = await db.select().from(applications).where(eq(applications.id, id));
    expect(stored.listingStatus).toBe("UNLISTED"); expect(stored.publishedRevisionId).toBeNull();
    expect(stored.assetVersion).toBe(4);
    const check = await (await preflight(request("GET", cookies.owner), context(id))).json();
    expect(check).toMatchObject({ externalImpact: "UNKNOWN", integrationStatus: "NOT_CONNECTED", retirementBlockers: ["OPEN_REVISION"] });
    await lifecycle(id, "RETIRED", "owner", false, 409);
    expect((await preflight(request("GET", cookies.employee), context(id))).status).toBe(404);
    expect((await preflight(request("GET"), context(id))).status).toBe(401);
    await lifecycle(id, "ACTIVE"); await lifecycle(id, "RETIRED", "owner", false, 409);
    await lifecycle(id, "DEPRECATED", "admin", true, 403);
  });
  it("requires archive/downlisting/manual attestation and preserves history on retirement/restoration", async () => {
    const { id, revision } = await readyForRetirement();
    const c = (await create(id, "components", { key: "api", name: "API" })).resource;
    await lifecycle(id, "RETIRED", "owner", false, 409);
    await patch(id, "components", c.id, { archived: true });
    await db.update(applications).set({ listingStatus: "LISTED" }).where(eq(applications.id, id));
    await lifecycle(id, "RETIRED", "owner", false, 409);
    await manageListing({ id: ids.adminOwner }, id, { action: "unlist", reason: "测试下架" });
    const missing = await lifeChange(request("POST", cookies.owner, { expectedVersion: await version(id), to: "RETIRED", reason: "退役" }), context(id));
    expect(missing.status).toBe(422);
    await lifecycle(id, "RETIRED");
    const [stored] = await db.select().from(applications).where(eq(applications.id, id));
    expect(stored.publishedRevisionId).toBe(revision.id); expect(stored.listingStatus).toBe("UNLISTED");
    const events = await (await getEvents(request("GET", cookies.owner), context(id))).json();
    expect(events.items[0]).toMatchObject({ action: "TRANSITIONED", afterState: { lifecycleStatus: "RETIRED", impactAcknowledged: true, impactSource: "MANUAL_ATTESTATION", externalImpact: "UNKNOWN" } });
    await lifecycle(id, "DEPRECATED", "owner", false, 403);
    await lifecycle(id, "DEPRECATED", "admin", true);
    expect((await read(id)).components[0].archivedAt).not.toBeNull();
    expect((await db.select().from(applications).where(eq(applications.id, id)))[0].listingStatus).toBe("UNLISTED");
  });
  it("freezes every legacy market write including direct calls and DB relisting", async () => {
    const { id, revision } = await readyForRetirement();
    await lifecycle(id, "RETIRED");
    for (const operation of [() => editDraft({ id: ids.owner }, id, { name: "Bypass" }), () => openNewDraft({ id: ids.owner }, id), () => submitDraft({ id: ids.owner }, id), () => reviewRevision({ id: ids.adminOwner }, revision.id, "APPROVED"), () => manageListing({ id: ids.adminOwner }, id, { action: "relist", reason: "绕过" })]) await expect(operation()).rejects.toMatchObject({ status: 409, code: "application_retired" });
    await expect(db.update(applications).set({ listingStatus: "LISTED" }).where(eq(applications.id, id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await lifecycle(id, "ACTIVE", "owner", false, 403);
  });
  it("rechecks retirement under the same lock against assets and relisting races", async () => {
    const first = await readyForRetirement();
    const results = await Promise.all([
      lifeChange(request("POST", cookies.owner, { expectedVersion: 1, to: "RETIRED", reason: "退役", impactAcknowledged: true }), context(first.id)),
      postAsset(request("POST", cookies.owner, { expectedVersion: 1, key: "api", name: "API" }), context(first.id)),
    ]);
    expect(results.map(r => r.status).filter(status => status < 300)).toHaveLength(1);
    expect(results.some(r => r.status === 409)).toBe(true);
    const second = await readyForRetirement();
    const raced = await Promise.all([
      lifeChange(request("POST", cookies.owner, { expectedVersion: 1, to: "RETIRED", reason: "退役", impactAcknowledged: true }), context(second.id)).then(response => response.status),
      manageListing({ id: ids.adminOwner }, second.id, { action: "relist", reason: "测试恢复上架" }).then(() => 200, error => { if (error.status !== 409) throw error; return 409; }),
    ]);
    expect(raced.sort()).toEqual([200, 409]);
    const [stored] = await db.select().from(applications).where(eq(applications.id, second.id));
    expect(stored.lifecycleStatus === "RETIRED" && stored.listingStatus === "LISTED").toBe(false);
    const third = await readyForRetirement();
    const oldVersion = await version(third.id);
    await create(third.id, "components", { key: "new", name: "New" });
    await lifecycle(third.id, "RETIRED", "owner", false, 409, oldVersion);
  });
  it("allows draft takeover but preserves both original creator and current owner self-review bans", async () => {
    const id = await app();
    // Original creator is an admin to exercise both sides of the self-review rule.
    await db.update(user).set({ role: "admin" }).where(eq(user.id, ids.owner));
    try {
      const transfer = await ownerTransfer(request("POST", cookies.admin, { expectedVersion: 1, newOwnerId: ids.adminOwner, reason: "负责人接管草稿" }), context(id));
      expect(transfer.status).toBe(200);
      expect((await getAssets(request("GET", cookies.owner), context(id))).status).toBe(404);
      const [revision] = await db.select().from(appRevisions).where(eq(appRevisions.appId, id));
      expect(revision.createdBy).toBe(ids.owner);
      await editDraft({ id: ids.adminOwner }, id, { name: "移交后编辑", summary: "已接管", description: "测试", category: "other", targetUrl: "https://example.test/new" });
      await submitDraft({ id: ids.adminOwner }, id);
      await expect(reviewRevision({ id: ids.adminOwner }, revision.id, "APPROVED")).rejects.toMatchObject({ status: 403, code: "self_review_forbidden" });
      await expect(reviewRevision({ id: ids.owner }, revision.id, "APPROVED")).rejects.toMatchObject({ status: 403, code: "self_review_forbidden" });
      await db.update(user).set({ canCreateApp: true }).where(eq(user.email, "t01-admin@example.test"));
      // Independent admin may review even while target owns the application.
      const [admin] = await db.select().from(user).where(eq(user.email, "t01-admin@example.test"));
      await reviewRevision({ id: admin.id }, revision.id, "APPROVED");
    } finally {
      await db.update(user).set({ role: "user" }).where(eq(user.id, ids.owner));
      await db.update(user).set({ canCreateApp: false }).where(eq(user.email, "t01-admin@example.test"));
    }
  });
  it("denies owner transfers to ineligible accounts, pending revisions and non-admins", async () => {
    const id = await app();
    const body = { expectedVersion: 1, newOwnerId: ids.other, reason: "移交" };
    expect((await ownerTransfer(request("POST", cookies.owner, body), context(id))).status).toBe(403);
    for (const target of ["missing", ids.disabled, ids.first, ids.employee]) expect((await ownerTransfer(request("POST", cookies.admin, { ...body, newOwnerId: target }), context(id))).status).toBe(422);
    await db.update(appRevisions).set({ status: "PENDING" }).where(eq(appRevisions.appId, id));
    expect((await ownerTransfer(request("POST", cookies.admin, body), context(id))).status).toBe(409);
    expect(await version(id)).toBe(1);
    await db.update(appRevisions).set({ status: "REJECTED" }).where(eq(appRevisions.appId, id));
    expect((await ownerTransfer(request("POST", cookies.admin, body), context(id))).status).toBe(200);
    expect((await ownerTransfer(request("POST", cookies.admin, body), context(id))).status).toBe(409);
  });
  it("rolls lifecycle and transfer back on audit failure", async () => {
    const { id } = await readyForRetirement();
    await db.execute(sql`CREATE FUNCTION p1_fail_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END; $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER p1_fail_audit BEFORE INSERT ON asset_events FOR EACH ROW EXECUTE FUNCTION p1_fail_audit()`);
    try {
      const retired = await lifeChange(request("POST", cookies.owner, { expectedVersion: 1, to: "RETIRED", reason: "退役", impactAcknowledged: true }), context(id));
      expect(retired.status).toBe(500);
      const transferred = await ownerTransfer(request("POST", cookies.admin, { expectedVersion: 1, newOwnerId: ids.other, reason: "移交" }), context(id));
      expect(transferred.status).toBe(500);
      const [stored] = await db.select().from(applications).where(eq(applications.id, id));
      expect(stored.lifecycleStatus).toBe("DEPRECATED"); expect(stored.ownerUserId).toBe(ids.owner); expect(stored.assetVersion).toBe(1);
    } finally { await db.execute(sql`DROP TRIGGER p1_fail_audit ON asset_events`); await db.execute(sql`DROP FUNCTION p1_fail_audit()`); }
  });
  it("serializes owner transfer against old-owner writes, and approval against retirement", async () => {
    const id = await app();
    const transferRace = await Promise.all([
      ownerTransfer(request("POST", cookies.admin, { expectedVersion: 1, newOwnerId: ids.other, reason: "并发移交" }), context(id)),
      postAsset(request("POST", cookies.owner, { expectedVersion: 1, key: "raced", name: "Raced" }), context(id)),
    ]);
    expect(transferRace.filter(response => response.status < 300)).toHaveLength(1);
    const statuses = transferRace.map(response => response.status).sort();
    expect([[200, 404], [201, 409]]).toContainEqual(statuses);
    const { id: reviewApp, revision } = await readyForRetirement();
    await db.update(appRevisions).set({ status: "PENDING" }).where(eq(appRevisions.id, revision.id));
    const retirement = lifeChange(request("POST", cookies.owner, { expectedVersion: 1, to: "RETIRED", reason: "退役", impactAcknowledged: true }), context(reviewApp));
    const approval = reviewRevision({ id: ids.adminOwner }, revision.id, "APPROVED");
    const [retireResponse] = await Promise.all([retirement, approval]);
    expect(retireResponse.status).toBe(409);
    const [stored] = await db.select().from(applications).where(eq(applications.id, reviewApp));
    expect(stored.lifecycleStatus).toBe("DEPRECATED"); expect(stored.listingStatus).toBe("LISTED");
  });

});
