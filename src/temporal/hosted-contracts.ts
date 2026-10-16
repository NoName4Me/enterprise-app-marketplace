export type HostedEnvironment = "TEST"|"PRODUCTION";
export type HostedReleaseInput = {
  releaseId:string;appId:string;environment:HostedEnvironment;
  environmentId:string;nodePort:number;repository:string;
  // Production consumes a previously VERIFIED TEST digest, never rebuilds.
  imageDigest?:string;
  // P5 handoff only: build source must descend from this GitHub-verified dev PR merge SHA.
  requiredMergeSha?:string;
};
export type HostedReleaseStage =
  | "QUEUED"|"BUILDING"|"WAITING_BUILD"|"OPENING_PR"|"AWAITING_PR"
  | "SYNCING"|"VERIFYING"|"READY"|"FAILED"|"NEEDS_RECONCILIATION";
export type HostedReleaseSnapshot = {
  stage:HostedReleaseStage;note:string;releaseId:string;
  sourceSha:string|null;buildRunId:string|null;imageDigest:string|null;
  gitopsPrNumber:number|null;testedAt:string|null;
};
export type ExternalAction =
  | {kind:"ACCEPTED";id:string;sourceSha?:string}
  | {kind:"REJECTED"|"UNKNOWN";reason:string};
export type BuildProgress =
  | {kind:"WAIT"}
  | {kind:"FAILED";reason:string}
  | {kind:"READY";imageDigest:string};
export type GitopsResult =
  | {kind:"ACCEPTED";prNumber:number}
  | {kind:"REJECTED"|"UNKNOWN";reason:string};
