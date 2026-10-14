import { expect, it } from "vitest";
import { lifecycleTransitions, validateGovernance } from "../src/domain/lifecycle-validation";
it("requires bounded reasons, explicit retirement attestation and fixed lifecycle actions", () => {
  expect(lifecycleTransitions.RETIRED).toEqual(["DEPRECATED"]);
  expect(validateGovernance({ expectedVersion: 1, to: "ACTIVE", reason: "登记维护阶段" })).toEqual({ version: 1, reason: "登记维护阶段" });
  for (const body of [
    { expectedVersion: 1, to: "UNKNOWN", reason: "reset" },
    { expectedVersion: 1, to: "RETIRED", reason: "退役" },
    { expectedVersion: 1, to: "RETIRED", reason: "退役", impactAcknowledged: "true" },
    { expectedVersion: 1, to: "ACTIVE", reason: "x".repeat(501) },
    { expectedVersion: 1, to: "ACTIVE", reason: "修改", owner: "forged" },
    { expectedVersion: 1, to: "ACTIVE", reason: "修改", impactAcknowledged: true },
  ]) expect(() => validateGovernance(body)).toThrow();
  expect(() => validateGovernance({ expectedVersion: 1, newOwnerId: "", reason: "移交" }, true)).toThrow();
});
