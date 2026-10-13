#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const event = process.env.GITHUB_EVENT_NAME;
const titles = ["pull_request", "pull_request_target"].includes(event)
  ? [process.env.PR_TITLE ?? ""]
  : execFileSync("git", ["log", "--format=%s"], { encoding: "utf8" }).trimEnd().split("\n");

const conventional = /^(feat|fix|docs|refactor|test|build|ci|chore|perf|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: .+$/u;
const failures = titles.filter(title => /[\r\n]/u.test(title) || !conventional.test(title) ||
  !/\p{Script=Han}/u.test(title.split(": ").slice(1).join(": ")));

if (failures.length) {
  console.error("提交信息或 PR 标题不符合 Conventional Commits 中文规范：");
  for (const title of failures) console.error(" - " + JSON.stringify(title));
  process.exitCode = 1;
} else {
  console.log(`提交信息检查通过（${titles.length} 条）。`);
}
