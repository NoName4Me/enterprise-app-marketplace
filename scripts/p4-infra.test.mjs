import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = path => readFileSync(path, "utf8");

test("Temporal uses the existing PostgreSQL instance with independent stores", () => {
  const chart = read("p4/temporal/values.yaml");
  assert.match(chart, /databaseName: temporal\n/);
  assert.match(chart, /databaseName: temporal_visibility\n/);
  assert.equal((chart.match(/connectAddr: "host\.docker\.internal:5432"/g) || []).length, 2);
  assert.equal((chart.match(/existingSecret: temporal-db-secret/g) || []).length, 2);
  assert.equal((chart.match(/manageSchema: true/g) || []).length, 2);
  assert.equal((chart.match(/createDatabase: false/g) || []).length, 2);
  assert.doesNotMatch(chart, /sqlite|elasticsearch:|cassandra:/i);
  const sql = read("p4/temporal/bootstrap-databases.psql");
  assert.match(sql, /CREATE DATABASE temporal OWNER temporal_user/);
  assert.match(sql, /CREATE DATABASE temporal_visibility OWNER temporal_user/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /DROP\s+DATABASE|TRUNCATE|DELETE\s+FROM|CREATE\s+DATABASE\s+market/i);
});

test("Portal and application Worker use Kubernetes Temporal Service DNS", () => {
  const portal = read("p4/platform/portal.yaml");
  const worker = read("p4/temporal/worker.yaml");
  for (const yaml of [portal, worker]) {
    assert.match(yaml, /temporal-frontend\.temporal\.svc\.cluster\.local:7233/);
    assert.match(yaml, /namespace: marketplace/);
    assert.doesNotMatch(yaml, /hostPath|docker\.sock|sqlite|\.env\.k8s/i);
  }
  assert.match(worker, /portal-worker-runtime/);
  assert.match(portal, /portal-runtime/);
  const dockerfile = read("p4/temporal/Dockerfile.worker");
  assert.match(dockerfile, /node:22-bookworm-slim/);
  assert.doesNotMatch(dockerfile, /COPY \./);
});

test("The unified Mac setup replaces separate SQLite/host installations", () => {
  const doc = read("docs/MAC_MINI_SETUP.md");
  assert.match(doc, /Temporal.*Kubernetes/);
  assert.match(doc, /market_pg/);
  assert.match(doc, /pg_dump/);
  assert.match(doc, /NOT RUN/);
  assert.doesNotMatch(doc, /^\s*temporal server start-dev/gm);
  const old = read("docs/TEMP_TEMPORAL_MAC_SETUP.md");
  assert.match(old, /MAC_MINI_SETUP\.md/);
});
