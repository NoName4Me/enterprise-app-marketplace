import { test } from "node:test";
import assert from "node:assert/strict";
import { updateRollout } from "./p4-open-promotion.mjs";
const source = "  image: ghcr.io/noname4me/enterprise-app-marketplace-lab@sha256:" + "0".repeat(64) + "\n";
const target = "  image: ghcr.io/noname4me/enterprise-app-marketplace-lab@sha256:" + "1".repeat(64) + "\n";
test("P4 promotion only changes the validated digest", () => {
  assert.equal(updateRollout(source, "sha256:" + "1".repeat(64)), target);
  assert.throws(() => updateRollout(source, "latest"));
  assert.throws(() => updateRollout(source + source, "sha256:" + "1".repeat(64)));
  assert.throws(() => updateRollout("image: attacker/repo:latest\n", "sha256:" + "1".repeat(64)));
});
