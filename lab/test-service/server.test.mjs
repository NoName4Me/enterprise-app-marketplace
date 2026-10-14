import { test } from "node:test";
import assert from "node:assert/strict";
import { createLabServer } from "./server.mjs";
async function withServer(config, operation) {
  const server = createLabServer(config);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await operation(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test("健康及版本来自实际服务；不提供HTTP故障注入入口", async () => {
  await withServer({ revision: "a".repeat(40) }, async base => {
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal((await (await fetch(base + "/version")).json()).revision, "a".repeat(40));
    const metrics = await (await fetch(base + "/metrics")).text();
    assert.match(metrics, /marketplace_lab_health 1/);
    assert.match(metrics, /marketplace_lab_info\{revision="a{40}"\} 1/);
    assert.equal((await fetch(base + "/fault", { method: "POST" })).status, 404);
    assert.equal((await fetch(base + "/health", { method: "POST" })).status, 404);
  });
});
test("仅本地允许固定故障；故障健康为503，版本仍可核对", async () => {
  assert.throws(() => createLabServer({ mode: "production", fault: "unhealthy" }));
  assert.throws(() => createLabServer({ fault: "arbitrary" }));
  assert.throws(() => createLabServer({ revision: "latest" }));
  await withServer({ fault: "unhealthy" }, async base => {
    assert.equal((await fetch(base + "/health")).status, 503);
    assert.match(await (await fetch(base + "/metrics")).text(), /marketplace_lab_health 0/);
    const version = await fetch(base + "/version");
    assert.equal(version.status, 200);
    assert.equal((await version.json()).faultMode, "unhealthy");
  });
});
