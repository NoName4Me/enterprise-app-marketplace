import { describe, expect, it } from "vitest";
import { parseArgoApplications } from "./argocd-model";

const appId = "11111111-1111-4111-8111-111111111111";
const environmentId = "22222222-2222-4222-8222-222222222222";
const environments = [{ id: environmentId, key: "test", name: "测试环境" }];
const allowed = new Set(["marketplace-lab"]);
function application(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "report-test", labels: { "marketplace-app-id": appId, "marketplace-environment-id": environmentId } },
    spec: { project: "marketplace-lab" },
    status: {
      sync: { status: "Synced", revision: "gitops-sha" },
      health: { status: "Healthy" },
      history: [{ revision: "last-synced-sha", deployedAt: "2026-10-14T12:00:00Z" }],
      summary: { images: ["ghcr.io/example/report@sha256:abcdef"] },
    },
    ...overrides,
  };
}
describe("Argo CD observation mapping", () => {
  it("requires the exact portal app, active environment and allowed Argo project", () => {
    const foreign = application({ metadata: { name: "foreign", labels: { "marketplace-app-id": "other", "marketplace-environment-id": environmentId } } });
    const otherEnvironment = application({ metadata: { name: "other", labels: { "marketplace-app-id": appId, "marketplace-environment-id": "archived" } } });
    const otherProject = application({ spec: { project: "untrusted" } });
    const result = parseArgoApplications({ items: [foreign, otherEnvironment, otherProject, application()] }, appId, environments, allowed);
    expect(result.applications).toHaveLength(1);
    expect(result.applications[0]).toMatchObject({
      name: "report-test", environmentKey: "test", sync: "Synced",
      health: "Healthy", desiredRevision: "gitops-sha", lastSyncedRevision: "last-synced-sha",
    });
  });
  it("does not equate unknown runtime facts with success", () => {
    const result = parseArgoApplications({ items: [application({ status: {} })] }, appId, environments, allowed);
    expect(result.applications[0]).toMatchObject({ sync: "Unknown", health: "Unknown", lastSyncedRevision: null });
  });
  it("rejects an unexpected Argo API response", () => {
    expect(() => parseArgoApplications({ error: "forbidden" }, appId, environments, allowed)).toThrow("invalid_argo_list");
  });
});
