import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { verifyService } from "./verify-service.mjs";
const revision = "a".repeat(40);
const version = { service: "marketplace-lab", environment: "local-lab", revision, faultMode: "healthy" };
async function withServer(handler, operation) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await operation(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test("容器替换连接中断后有限重试，实际服务版本与健康恢复后通过", async () => {
  let requests = 0;
  await withServer((request, response) => {
    requests++;
    if (requests === 1) { request.socket.destroy(); return; }
    response.end(JSON.stringify(request.url === "/version" ? version : { status: "ok" }));
  }, async url => {
    await verifyService(url, revision, "healthy", { delayMs: 1 });
    assert.ok(requests >= 3);
  });
});
test("错误版本不重试掩盖，持续断连在限定次数后失败", async () => {
  let requests = 0;
  await withServer((request, response) => {
    requests++;
    response.end(JSON.stringify(request.url === "/version" ? { ...version, revision: "b".repeat(40) } : { status: "ok" }));
  }, async url => {
    await assert.rejects(verifyService(url, revision, "healthy", { delayMs: 1 }), /version\/health mismatch/);
    assert.equal(requests, 2);
  });
  requests = 0;
  await withServer(request => { requests++; request.socket.destroy(); }, async url => {
    await assert.rejects(verifyService(url, revision, "healthy", { attempts: 3, delayMs: 1, timeoutMs: 100 }));
    assert.equal(requests, 3);
  });
});
