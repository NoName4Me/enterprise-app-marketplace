import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyMergedPullRequest } from "./activities";

const repo = "Example/repo";
const requirementId = "11111111-1111-4111-8111-111111111111";
const mergedPr = {
  merged: true, base: { ref: "dev" },
  body: "Portal-Requirement-ID: " + requirementId,
  merge_commit_sha: "a".repeat(40),
  html_url: "https://github.com/Example/repo/pull/7",
};
function mockResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("P5 Temporal GitHub PR and CI gate", () => {
  it("requires PR merge and target dev, never infers success from PR creation", async () => {
    vi.stubEnv("P5_COPILOT_USER_TOKEN", "test-token");
    const fetch = vi.fn(async () => mockResponse({ ...mergedPr, merged: false }));
    vi.stubGlobal("fetch", fetch);
    const result = await verifyMergedPullRequest(repo, 7, requirementId);
    expect(result.verified).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("requires requirement correlation marker", async () => {
    vi.stubEnv("P5_COPILOT_USER_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse({ ...mergedPr, body: "unrelated" })));
    expect((await verifyMergedPullRequest(repo, 7, requirementId)).verified).toBe(false);
  });
  it("never advances on missing or pending checks", async () => {
    vi.stubEnv("P5_COPILOT_USER_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(async (url: URL|string) =>
      mockResponse(String(url).includes("/check-runs")
        ? { total_count: 1, check_runs: [{ status: "in_progress", conclusion: null }] }
        : mergedPr)));
    expect((await verifyMergedPullRequest(repo, 7, requirementId)).verified).toBe(false);
  });
  it("advances only when all merge commit GitHub checks succeed", async () => {
    vi.stubEnv("P5_COPILOT_USER_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(async (url: URL|string) =>
      mockResponse(String(url).includes("/check-runs")
        ? { total_count: 2, check_runs: [
          { status: "completed", conclusion: "success" },
          { status: "completed", conclusion: "success" },
        ] } : mergedPr)));
    const result = await verifyMergedPullRequest(repo, 7, requirementId);
    expect(result.verified).toBe(true);
    expect(result.url).toBe("https://github.com/Example/repo/pull/7");
    expect(result.mergeSha).toBe("a".repeat(40));
  });
});
