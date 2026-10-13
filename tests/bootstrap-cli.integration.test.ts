import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import pg from "pg";

const fixture = new URL(process.env.DATABASE_URL!);
if (process.env.CI !== "true" || !["localhost", "127.0.0.1"].includes(fixture.hostname) || fixture.pathname !== "/market_test") throw new Error("Isolated CI fixture required");
const database = "bootstrap_" + randomUUID().replaceAll("-", "");
const isolated = new URL(fixture); isolated.pathname = "/" + database;
const manager = new pg.Client({ connectionString: fixture.href });
const client = new pg.Client({ connectionString: isolated.href });
const password = "Fixture-bootstrap-password-not-a-real-secret-123!";
let created = false, connected = false;
function bootstrap(email: string) {
  return new Promise<number | null>((resolve, reject) => {
    // This bundled entry invokes the same controlled API as the interactive CLI.
    const child = spawn(process.execPath, ["node_modules/.cache/marketplace-bootstrap.cjs"], {
      env: { ...process.env, DATABASE_URL: isolated.href }, stdio: ["pipe", "ignore", "ignore"],
    });
    child.once("error", reject); child.once("exit", resolve);
    child.stdin.end(JSON.stringify({ email, name: "隔离初始化测试", password }));
  });
}
beforeAll(async () => {
  await manager.connect();
  await manager.query(`CREATE DATABASE "${database}"`); created = true;
  execFileSync("pnpm", ["db:migrate"], { env: { ...process.env, DATABASE_URL: isolated.href }, stdio: "ignore" });
  await client.connect(); connected = true;
}, 30000);
afterAll(async () => {
  if (connected) await client.end();
  if (created) await manager.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await manager.end();
});
describe.sequential("空库初始化事务与并发回归", () => {
  it("创建审计失败时账号、密码凭据与审计一并回滚", async () => {
    await client.query(`CREATE FUNCTION fail_bootstrap_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_bootstrap_audit BEFORE INSERT ON security_events FOR EACH ROW EXECUTE FUNCTION fail_bootstrap_audit()`);
    try {
      expect(await bootstrap("rollback@example.test")).toBe(1);
      for (const table of ["user", "account", "security_events"]) {
        expect((await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)).rows[0].n).toBe(0);
      }
    } finally { await client.query("DROP TRIGGER fail_bootstrap_audit ON security_events; DROP FUNCTION fail_bootstrap_audit()"); }
  });
  it("并发初始化仅一个成功；重复创建拒绝且保留原密码和首登限制", async () => {
    const results = await Promise.all([bootstrap("first@example.test"), bootstrap("second@example.test")]);
    expect(results.sort()).toEqual([0, 1]);
    const before = await client.query('SELECT id, role, email_verified, must_change_password, banned, can_create_app FROM "user"');
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0]).toMatchObject({ role: "admin", email_verified: true, must_change_password: true, banned: false, can_create_app: false });
    const credentials = await client.query('SELECT id, password FROM "account"');
    expect(await bootstrap("third@example.test")).toBe(1);
    expect((await client.query('SELECT id, password FROM "account"')).rows).toEqual(credentials.rows);
    expect((await client.query('SELECT COUNT(*)::int AS n FROM security_events')).rows[0].n).toBe(1);
  });
});
