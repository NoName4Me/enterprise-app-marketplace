// Shared contracts: no Node, database, UI or external SDK dependencies.
export const DELIVERY_QUEUE = "portal-delivery";
export type DeliveryInput = {
  requirementId: string;
  type: "FEATURE" | "BUG" | "IMPROVEMENT";
  repository: string;
  title: string;
  description: string;
};
export type DeliveryStage =
  | "ANALYZING" | "AWAITING_APPROVAL" | "REJECTED" | "DISPATCHING"
  | "AGENT_RUNNING" | "AWAITING_PR_REVIEW" | "NEEDS_RECONCILIATION"
  | "PROVIDER_REJECTED" | "FOLLOW_UP_REQUIRED";
export type DeliverySnapshot = {
  stage: DeliveryStage;
  plan: string | null;
  repository: string;
  externalTaskId: string | null;
  note: string;
  lastCheckedAt: string | null;
};
export type DispatchResult =
  | { outcome: "ACCEPTED"; taskId: string }
  | { outcome: "REJECTED" | "UNKNOWN"; reason: string };
