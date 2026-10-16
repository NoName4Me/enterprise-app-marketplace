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
  | "AGENT_RUNNING" | "AWAITING_PR_REVIEW" | "VERIFYING_PR" | "AWAITING_TEST_RELEASE" | "NEEDS_RECONCILIATION"
  | "PROVIDER_REJECTED" | "FOLLOW_UP_REQUIRED";
export type DeliverySnapshot = {
  stage: DeliveryStage;
  plan: string | null;
  repository: string;
  externalTaskId: string | null;
  reviewedPrUrl?: string;
  reviewedMergeSha?: string; // GitHub-verified dev merge SHA; never a client assertion.
  note: string;
  lastCheckedAt: string | null;
};
export type DispatchResult =
  | { outcome: "ACCEPTED"; taskId: string }
  | { outcome: "REJECTED" | "UNKNOWN"; reason: string };
