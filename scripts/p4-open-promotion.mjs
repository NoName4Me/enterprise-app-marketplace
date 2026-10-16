#!/usr/bin/env node
/* Opens a GitOps PR for a trusted GHCR digest; no Mac credentials. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, env } from "node:process";
import { verifyPublication, verifyManifest, verifyCI, REPOSITORY, IMAGE } from "../lab/release-policy.mjs";
function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 3_000_000, timeout: 90_000 });
  if (result.error || result.status !== 0) throw new Error(cmd + " " + args.slice(0, 4).join(" ") + " failed: " + (result.stderr || result.error?.message || "").slice(0, 300));
  return result.stdout.trim();
}
function api(path) { return JSON.parse(run("gh", ["api", "repos/" + REPOSITORY + "/" + path])); }
export function updateRollout(content, digest) {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid immutable image digest.");
  const pattern = /^([ \t]*image:[ \t]*)ghcr\.io\/noname4me\/enterprise-app-marketplace-lab@sha256:[a-f0-9]{64}[ \t]*$/gm;
  if ([...content.matchAll(pattern)].length !== 1) throw new Error("Expected exactly one trusted lab image.");
  return content.replace(pattern, (_line, prefix) => prefix + IMAGE + "@" + digest);
}
function assertBranch() {
  if (run("git", ["branch", "--show-current"]) !== "dev") throw new Error("Run from dev branch.");
  if (run("git", ["status", "--porcelain"])) throw new Error("Working tree must be clean.");
}
export async function openPromotion(runID, variant) {
  if (!/^[1-9][0-9]{0,18}$/.test(runID) || !["healthy", "unhealthy"].includes(variant))
    throw new Error("Usage: node scripts/p4-open-promotion.mjs <publication-run-id> healthy|unhealthy");
  if (!env.GH_TOKEN && !env.GITHUB_TOKEN) throw new Error("Set GH_TOKEN or GITHUB_TOKEN.");
  assertBranch();
  const publication = verifyPublication(api("actions/runs/" + runID));
  const folder = mkdtempSync(join(tmpdir(), "marketplace-p4-"));
  try {
    run("gh", ["run", "download", runID, "--repo", REPOSITORY, "--name", "lab-release", "--dir", folder]);
    const manifest = verifyManifest(JSON.parse(readFileSync(join(folder, "lab-release.json"), "utf8")), publication);
    const ci = api("actions/runs/" + manifest.ciRunID);
    const jobs = api("actions/runs/" + manifest.ciRunID + "/jobs?per_page=100").jobs;
    verifyCI(ci, jobs, manifest.sourceSHA);
    const path = "p4/gitops/lab/rollout.yaml";
    const original = readFileSync(path, "utf8");
    const revised = updateRollout(original, manifest.images[variant].digest);
    if (original === revised) throw new Error("This image is already declared.");
    const branch = "p4/promote-" + runID + "-" + variant + "-" + (env.GITHUB_RUN_ID || Date.now());
    run("git", ["switch", "-c", branch]);
    writeFileSync(path, revised);
    run("git", ["add", "--", path]);
    run("git", ["-c", "user.name=p4-gitops", "-c", "user.email=p4-gitops@users.noreply.github.com",
      "commit", "-m", "chore(p4): 更新 " + variant + " GitOps 镜像摘要"]);
    run("git", ["push", "origin", "HEAD:refs/heads/" + branch]);
    const body = "可信发布 Run #" + runID + "\n\nCI #" + manifest.ciRunID +
      "\n\nSource SHA: " + manifest.sourceSHA + "\n\nImage: " + IMAGE + "@" + manifest.images[variant].digest +
      "\n\nMerge into dev -> Argo CD sync -> manual Argo Rollouts promote.";
    try {
      console.log(run("gh", ["pr", "create", "--repo", REPOSITORY, "--base", "dev", "--head", branch,
        "--title", "chore(p4): 发布已验证 " + variant + " 镜像", "--body", body]));
    } catch (error) {
      console.error("Branch pushed; if automatic PR creation is disabled, open a PR to dev from " + branch);
      throw error;
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
}
if (process.argv[1]?.endsWith("/p4-open-promotion.mjs")) {
  openPromotion(argv[2] || "", argv[3] || "").catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
