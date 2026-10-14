import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

// Own ephemeral database: no fixture/development data is dropped or rewritten.
describe("P1 additive migration from the legacy schema", () => {
  it("preserves every legacy column and rolls back a failed forward migration", async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/market_test") throw new Error("Migration proof requires local isolated market_test");
    const name = "market_p1_migration_" + randomUUID().replaceAll("-", "");
    const control = new Client({ connectionString: url.href });
    await control.connect();
    let client: Client | undefined;
    try {
      await control.query(`CREATE DATABASE "${name}"`);
      url.pathname = "/" + name;
      client = new Client({ connectionString: url.href }); await client.connect();
      const files = readdirSync("drizzle").filter(file => /^\d{4}.*\.sql$/.test(file)).sort();
      for (const file of files.filter(file => Number(file.slice(0, 4)) <= 4)) await client.query(readFileSync("drizzle/" + file, "utf8"));
      await client.query(`INSERT INTO "user" (id,name,email,role,must_change_password,can_create_app) VALUES ('old-owner','Owner','owner@example.test','user',false,true),('old-admin','Admin','admin@example.test','admin',false,false)`);
      const apps = Array.from({ length: 4 }, () => randomUUID());
      const revisions = Array.from({ length: 5 }, () => randomUUID());
      for (const id of apps) await client.query(`INSERT INTO applications(id,owner_user_id) VALUES($1,'old-owner')`, [id]);
      for (const [i, status, appIndex, sequence] of [[0, "APPROVED", 0, 1], [1, "PENDING", 0, 2], [2, "DRAFT", 1, 1], [3, "REJECTED", 2, 1], [4, "APPROVED", 3, 1]] as const) {
        await client.query(`INSERT INTO app_revisions(id,app_id,sequence,status,name,target_url,created_by) VALUES($1,$2,$3,$4,$5,'https://example.test/legacy','old-owner')`, [revisions[i], apps[appIndex], sequence, status, "Legacy " + status]);
      }
      await client.query(`UPDATE applications SET listing_status='LISTED',published_revision_id=$1 WHERE id=$2`, [revisions[0], apps[0]]);
      await client.query(`UPDATE applications SET published_revision_id=$1 WHERE id=$2`, [revisions[4], apps[3]]);
      await client.query(`INSERT INTO review_events(app_id,revision_id,actor_user_id,action) VALUES($1,$2,'old-admin','APPROVED')`, [apps[0], revisions[0]]);
      await client.query(`INSERT INTO app_favorites(app_id,user_id) VALUES($1,'old-owner')`, [apps[0]]);
      await client.query(`INSERT INTO app_feedback(app_id,user_id,rating,body) VALUES($1,'old-owner',4,'Historical feedback')`, [apps[0]]);
      await client.query(`INSERT INTO app_discussions(app_id,user_id,body) VALUES($1,'old-owner','Historical discussion')`, [apps[0]]);
      await client.query(`INSERT INTO catalog_events(app_id,actor_user_id,action) VALUES($1,'old-admin','LISTED')`, [apps[0]]);
      const columns = (await client.query<{ table_name: string; column_name: string }>(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows;
      const groups = new Map<string, string[]>();
      for (const row of columns) groups.set(row.table_name, [...(groups.get(row.table_name) ?? []), row.column_name]);
      async function snapshot() {
        const result: Record<string, unknown> = {};
        for (const [table, fields] of groups) {
          const projection = fields.map(field => `"${field}"`).join(",");
          result[table] = (await client!.query(`SELECT record FROM (SELECT to_jsonb(x) AS record FROM (SELECT ${projection} FROM "${table}") x) q ORDER BY record::text`)).rows;
        }
        return result;
      }
      const before = await snapshot();
      const migration = readFileSync("drizzle/" + files.find(file => file.startsWith("0005_"))!, "utf8");
      // Failure after all DDL: PostgreSQL must preserve the entire old schema/data.
      await client.query("BEGIN"); await client.query(migration);
      await expect(client.query("SELECT 1/0")).rejects.toMatchObject({ code: "22012" });
      await client.query("ROLLBACK");
      expect((await client.query("SELECT to_regclass('public.app_components') AS table")).rows[0].table).toBeNull();
      expect(await snapshot()).toEqual(before);
      await client.query("BEGIN"); await client.query(migration); await client.query("COMMIT");
      expect(await snapshot()).toEqual(before);
      const state = (await client.query(`SELECT asset_version,lifecycle_status,responsible_team_name FROM applications`)).rows;
      expect(state).toHaveLength(4);
      for (const item of state) expect(item).toEqual({ asset_version: 1, lifecycle_status: "UNKNOWN", responsible_team_name: null });
      for (const table of ["app_components", "app_environments", "component_environments", "external_references", "asset_events"]) expect((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
      await expect(client.query(`UPDATE applications SET lifecycle_status='RETIRED' WHERE id=$1`, [apps[0]])).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client?.end();
      await control.query(`DROP DATABASE IF EXISTS "${name}"`);
      await control.end();
    }
  }, 30000);
});
