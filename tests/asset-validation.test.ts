import { describe, expect, it } from "vitest";
import { assetResource, repositoryName, validateAssetCreate, validateAssetPatch, validateTeamPatch } from "../src/domain/asset-validation";
const componentId = "11111111-1111-4111-8111-111111111111";
const repository = { expectedVersion: 1, componentId, resourceKind: "REPOSITORY", repositoryFullName: "Example/Portal" };
describe("private asset input boundary", () => {
  it("normalizes GitHub identifiers without accepting URLs or credentials", () => {
    expect(repositoryName(" Example/Portal ")).toBe("example/portal");
    for (const input of ["https://github.com/a/b", "javascript:alert(1)", "http://127.0.0.1/a", "a/..", "a/b/c", "a/b?token=secret", "a@secret/b", "a/", "-a/b"]) expect(() => repositoryName(input)).toThrow();
    expect(validateAssetCreate("references", repository)).toMatchObject({ provider: "GITHUB", bindingId: null, workflowId: null });
    expect(validateAssetCreate("references", { ...repository, resourceKind: "WORKFLOW", workflowId: "382348450" })).toMatchObject({ workflowId: "382348450" });
  });
  it("rejects privilege, runtime status and all unknown fields", () => {
    for (const field of ["actor", "owner", "role", "status", "publishedRevisionId", "assetVersion", "token", "healthStatus", "lastCollectedAt", "url"]) expect(() => validateAssetCreate("references", { ...repository, [field]: "forged" })).toThrow();
    for (const workflowId of ["0", "-1", "1e3", "01", "1/../../secret", 123, "1".repeat(21)]) expect(() => validateAssetCreate("references", { ...repository, resourceKind: "WORKFLOW", workflowId })).toThrow();
    expect(() => validateAssetCreate("references", { ...repository, workflowId: "1" })).toThrow();
    expect(() => validateAssetCreate("references", { ...repository, provider: "OTHER" })).toThrow();
  });
  it("bounds text, versions and environment purposes", () => {
    const body = { expectedVersion: 1, key: "api", name: "API" };
    for (const expectedVersion of [0, -1, 1.2, "1", 2147483647, null]) expect(() => validateAssetCreate("components", { ...body, expectedVersion })).toThrow();
    expect(() => validateAssetCreate("components", { ...body, name: "x".repeat(121) })).toThrow();
    expect(() => validateAssetCreate("components", { ...body, notes: "x".repeat(1001) })).toThrow();
    expect(() => validateAssetCreate("components", { ...body, notes: "a\0b" })).toThrow();
    expect(() => validateAssetCreate("environments", { ...body, purpose: "HEALTHY" })).toThrow();
    expect(validateTeamPatch({ expectedVersion: 1, responsibleTeamName: null })).toBeNull();
    expect(() => validateTeamPatch({ expectedVersion: 1, responsibleTeamName: "x".repeat(101) })).toThrow();
  });
  it("keeps keys and relationship identities stable across archive/restore", () => {
    expect(validateAssetPatch("components", { expectedVersion: 1, archived: true })).toEqual({ archived: true });
    for (const body of [{ expectedVersion: 1 }, { expectedVersion: 1, key: "changed" }, { expectedVersion: 1, archived: true, name: "mixed" }]) expect(() => validateAssetPatch("components", body)).toThrow();
    expect(() => validateAssetPatch("bindings", { expectedVersion: 1, componentId })).toThrow();
    expect(() => assetResource("users")).toThrow();
  });
});
