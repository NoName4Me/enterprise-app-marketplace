#!/usr/bin/env bash
set -euo pipefail
test "$(uname -m)" = aarch64
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
[[ "$SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$CI_RUN_ID" =~ ^[0-9]+$ && "$PUBLISH_RUN_ID" =~ ^[0-9]+$ ]]
image=ghcr.io/noname4me/enterprise-app-marketplace-lab
trap 'docker rm -f lab-publish-smoke >/dev/null 2>&1 || true; docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
for variant in healthy unhealthy; do
  docker build --platform linux/arm64 --build-arg SOURCE_REVISION="$SOURCE_SHA" \
    --build-arg DEFAULT_FAULT="$variant" --tag "$image:$SOURCE_SHA-$variant" lab/test-service
  test "$(docker image inspect "$image:$SOURCE_SHA-$variant" --format '{{.Architecture}}')" = arm64
  docker run --detach --name lab-publish-smoke --read-only --cap-drop ALL \
    --security-opt no-new-privileges --memory 64m --cpus .5 \
    --publish 127.0.0.1:3382:8080 "$image:$SOURCE_SHA-$variant"
  VARIANT="$variant" node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
let version;
for (let attempt = 0; attempt < 20; attempt++) {
  try { version = await (await fetch('http://127.0.0.1:3382/version', {signal: AbortSignal.timeout(2000)})).json(); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 500)); }
}
assert.equal(version?.revision, process.env.SOURCE_SHA);
assert.equal(version?.faultMode, process.env.VARIANT);
assert.equal((await fetch('http://127.0.0.1:3382/health')).status, process.env.VARIANT === 'healthy' ? 200 : 503);
JS
  docker rm -f lab-publish-smoke
done
# Only this trusted job receives a short-lived package-write token; no PAT or Mac credentials.
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_ACTOR" --password-stdin
for variant in healthy unhealthy; do
  docker push "$image:$SOURCE_SHA-$variant"
  reference=$(docker image inspect "$image:$SOURCE_SHA-$variant" --format '{{index .RepoDigests 0}}')
  digest="${reference##*@}"
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]
  if test "$variant" = healthy; then export HEALTHY_DIGEST="$digest"; else export UNHEALTHY_DIGEST="$digest"; fi
done
node --input-type=module - <<'JS'
import { writeFileSync, appendFileSync } from 'node:fs';
import { IMAGE, REPOSITORY } from './lab/release-policy.mjs';
const record = { schemaVersion: 1, repository: REPOSITORY, sourceSHA: process.env.SOURCE_SHA,
  ciRunID: Number(process.env.CI_RUN_ID), publishRunID: Number(process.env.PUBLISH_RUN_ID),
  publishedAt: new Date().toISOString(), images: {} };
for (const [variant, digest] of [['healthy', process.env.HEALTHY_DIGEST], ['unhealthy', process.env.UNHEALTHY_DIGEST]]) {
  record.images[variant] = {repository: IMAGE, digest, platform: 'linux/arm64'};
}
if (record.images.healthy.digest === record.images.unhealthy.digest) throw new Error('Expected distinct digests.');
writeFileSync('lab-release.json', JSON.stringify(record, null, 2) + '\n');
appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## 实验镜像发布\n\n```json\n' + JSON.stringify(record, null, 2) + '\n```\n');
JS
