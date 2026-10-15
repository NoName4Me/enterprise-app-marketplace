import { condition, defineQuery, defineSignal, proxyActivities, setHandler, sleep } from "@temporalio/workflow";
import type { DeliveryInput, DeliverySnapshot } from "./contracts";
import type * as activities from "./activities";

export const deliveryStatus = defineQuery<DeliverySnapshot>("deliveryStatus");
export const reviewDeliveryPlan = defineSignal<["APPROVE" | "REJECT"]>("reviewDeliveryPlan");

const { prepareDeliveryPlan } = proxyActivities<Pick<typeof activities, "prepareDeliveryPlan">>({
  startToCloseTimeout: "45 seconds",
  retry: { maximumAttempts: 2 },
});
// GitHub task creation has an ambiguous-outcome hazard: NEVER auto retry a timed-out POST.
const { createCodingTask, getCodingTaskProgress } = proxyActivities<
  Pick<typeof activities, "createCodingTask" | "getCodingTaskProgress">
>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
});

export async function deliveryWorkflow(input: DeliveryInput): Promise<DeliverySnapshot> {
  let state: DeliverySnapshot = {
    stage: "ANALYZING", plan: null, repository: input.repository,
    externalTaskId: null, note: "需求分析中", lastCheckedAt: null,
  };
  let decision: "APPROVE" | "REJECT" | null = null;
  setHandler(deliveryStatus, () => state);
  setHandler(reviewDeliveryPlan, value => {
    if (state.stage === "AWAITING_APPROVAL" && decision === null) decision = value;
  });
  state = { ...state, plan: await prepareDeliveryPlan(input), stage: "AWAITING_APPROVAL",
    note: "等待应用负责人确认方案；未经确认不得启动编码或发布。" };
  await condition(() => decision !== null);
  if (decision === "REJECT") return { ...state, stage: "REJECTED", note: "方案被负责人拒绝，未派发代码任务。" };

  state = { ...state, stage: "DISPATCHING", note: "向外部 Coding Agent 派发任务（仅一次）。" };
  let dispatch;
  try { dispatch = await createCodingTask(input, state.plan!); }
  catch { return { ...state, stage: "NEEDS_RECONCILIATION",
    note: "外部请求可能已执行，但响应未知；停止自动重试，须先核对 GitHub。" }; }
  if (dispatch.outcome === "UNKNOWN") return { ...state, stage: "NEEDS_RECONCILIATION", note: dispatch.reason };
  if (dispatch.outcome === "REJECTED") return { ...state, stage: "PROVIDER_REJECTED", note: dispatch.reason };
  state = { ...state, stage: "AGENT_RUNNING", externalTaskId: dispatch.taskId, note: "GitHub Coding Agent 执行中；PR 和 CI 尚未核验。" };

  // Bounded polling in first cut; later replace with webhook/signal and Continue-as-New.
  for (let attempt = 0; attempt < 240; attempt++) {
    await sleep("5 minutes");
    const progress = await getCodingTaskProgress(input.repository, dispatch.taskId);
    state = { ...state, lastCheckedAt: new Date().toISOString(), note: progress.note };
    if (progress.kind === "DONE") return { ...state, stage: "AWAITING_PR_REVIEW",
      note: "Agent 执行结束；人工审查 PR/CI 后才能进入 GitOps 发布。" };
    if (progress.kind === "FAILED") return { ...state, stage: "FOLLOW_UP_REQUIRED",
      note: "Agent 执行失败，需负责人检查，不自动重复派发任务。" };
  }
  return { ...state, stage: "FOLLOW_UP_REQUIRED", note: "超过观察窗口，需由后续事件接入继续推进。" };
}
