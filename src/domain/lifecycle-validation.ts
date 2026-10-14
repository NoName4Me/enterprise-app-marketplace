import { AppError } from "./app-errors";
import { expectedVersion } from "./asset-validation";
export const lifecycleStates = ["UNKNOWN", "PILOT", "ACTIVE", "DEPRECATED", "RETIRED"] as const;
export type Lifecycle = typeof lifecycleStates[number];
export const lifecycleTransitions: Record<Lifecycle, readonly Lifecycle[]> = {
  UNKNOWN: ["PILOT", "ACTIVE", "DEPRECATED"], PILOT: ["ACTIVE", "DEPRECATED"], ACTIVE: ["PILOT", "DEPRECATED"], DEPRECATED: ["ACTIVE", "RETIRED"], RETIRED: ["DEPRECATED"],
};
export function validateGovernance(body: Record<string, unknown>, transfer = false) {
  const fields = transfer ? ["expectedVersion", "newOwnerId", "reason"] : ["expectedVersion", "to", "reason", "impactAcknowledged"];
  if (Object.keys(body).some(key => !fields.includes(key))) throw new AppError(422, "invalid_governance_fields");
  const version = expectedVersion(body);
  if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(body.reason)) throw new AppError(422, "reason_required");
  if (transfer) {
    if (typeof body.newOwnerId !== "string" || !body.newOwnerId || body.newOwnerId.length > 160) throw new AppError(422, "invalid_owner");
  } else {
    if (!lifecycleStates.includes(body.to as Lifecycle) || body.to === "UNKNOWN") throw new AppError(422, "invalid_lifecycle");
    if (body.impactAcknowledged !== undefined && typeof body.impactAcknowledged !== "boolean") throw new AppError(422, "invalid_governance_fields");
    if (body.to === "RETIRED" && body.impactAcknowledged !== true) throw new AppError(422, "impact_acknowledgement_required");
    if (body.to !== "RETIRED" && "impactAcknowledged" in body) throw new AppError(422, "invalid_governance_fields");
  }
  return { version, reason: body.reason.trim() };
}
