import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCI, verifyPublication, verifyManifest, verifyLocalTarget, REPOSITORY, IMAGE, CI_PATH, RELEASE_PATH } from "./release-policy.mjs";
const sha = "a".repeat(40);
const repository = { full_name: REPOSITORY };
const ci = { id: 12, repository, head_repository: repository, path: CI_PATH, event: "push", head_branch: "master", head_sha: sha, status: "completed", conclusion: "success" };
const jobs = [{ name: "validate", run_id: 12, status: "completed", conclusion: "success" }];
const publication = { ...ci, id: 13, path: RELEASE_PATH, event: "workflow_run" };
const image = digit => ({ repository: IMAGE, digest: "sha256:" + digit.repeat(64), platform: "linux/arm64" });
const manifest = { schemaVersion: 1, repository: REPOSITORY, sourceSHA: sha, publishRunID: 13, ciRunID: 12, images: { healthy: image("b"), unhealthy: image("c") } };

test("部署和停止限定本机Mac/OrbStack，拒绝远程Docker及环境变量覆盖", () => {
  const target = { platform: "darwin", architecture: "arm64", context: "orbstack", endpoint: "unix:///local/orbstack.sock" };
  verifyLocalTarget(target);
  for (const patch of [{ platform: "linux" }, { architecture: "x64" }, { context: "production" }, { endpoint: "ssh://remote" }, { endpoint: "tcp://remote:2376" }, { dockerHostOverride: "unix:///different/socket" }]) {
    assert.throws(() => verifyLocalTarget({ ...target, ...patch }));
  }
});

test("可信master完整CI通过才允许发布，拒绝PR、fork、旧SHA和失败/缺失检查", () => {
  assert.equal(verifyCI(ci, jobs, sha), sha);
  for (const patch of [{ event: "pull_request" }, { head_branch: "feature" }, { conclusion: "failure" }, { status: "in_progress" }, { head_repository: { full_name: "attacker/fork" } }, { path: "arbitrary.yml" }, { head_sha: "b".repeat(40) }]) {
    assert.throws(() => verifyCI({ ...ci, ...patch }, jobs, sha));
  }
  assert.throws(() => verifyCI(ci, [], sha));
  assert.throws(() => verifyCI(ci, [{ ...jobs[0], conclusion: "failure" }], sha));
  assert.throws(() => verifyCI(ci, [{ ...jobs[0], run_id: 11 }], sha));
});
test("部署只接受成功的可信发布run，摘要/架构/仓库/SHA/两版本身份必须一致", () => {
  assert.equal(verifyManifest(manifest, publication), manifest);
  assert.equal(verifyManifest(manifest, { ...publication, event: "workflow_dispatch" }), manifest);
  assert.throws(() => verifyPublication({ ...publication, event: "pull_request" }));
  assert.throws(() => verifyPublication({ ...publication, conclusion: "failure" }));
  for (const patch of [{ sourceSHA: "b".repeat(40) }, { publishRunID: 14 }, { repository: "attacker/repo" }, { images: { ...manifest.images, healthy: { ...image("b"), repository: "arbitrary/image" } } }, { images: { ...manifest.images, healthy: { ...image("b"), digest: "latest" } } }, { images: { ...manifest.images, healthy: { ...image("b"), platform: "linux/amd64" } } }, { images: { healthy: image("b"), unhealthy: image("b") } }]) {
    assert.throws(() => verifyManifest({ ...manifest, ...patch }, publication));
  }
});
