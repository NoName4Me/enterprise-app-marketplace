import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
function check(title: string, event = "pull_request_target") {
  return spawnSync(process.execPath, ["scripts/check-commit-messages.mjs"], {
    env: { ...process.env, GITHUB_EVENT_NAME: event, PR_TITLE: title }, encoding: "utf8", shell: false,
  });
}
describe("可信 PR 标题门禁", () => {
  it("接受中文 Conventional Commits，并拒绝英文、缺失类型和空标题", () => {
    expect(check("fix(auth): 修复管理员初始化").status).toBe(0);
    for (const title of ["fix(auth): initialize admin", "中文标题", "", "Merge pull request #1", "chore(deps): bump package"]) expect(check(title).status).toBe(1);
  });
  it("不把外部标题当作 shell 指令或工作流命令执行", () => {
    const result = check('fix(auth): 中文 $(exit 77) `exit 77`\n::error::untrusted');
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("untrusted");
  });
});
