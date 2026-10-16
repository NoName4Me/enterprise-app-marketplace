import { condition, defineQuery, defineSignal, proxyActivities, setHandler, sleep } from "@temporalio/workflow";
import type { DeliveryInput, DeliverySnapshot } from "./contracts";
import type * as activities from "./activities";

export const deliveryStatus = defineQuery<DeliverySnapshot>("deliveryStatus");
export const reviewDeliveryPlan = defineSignal<["APPROVE" | "REJECT", string]>("reviewDeliveryPlan");
export const requestPrVerification = defineSignal<[number,string]>("requestPrVerification");

const { prepareDeliveryPlan } = proxyActivities<Pick<typeof activities, "prepareDeliveryPlan">>({
  startToCloseTimeout: "45 seconds",
  retry: { maximumAttempts: 2 },
});
// GitHub task creation has an ambiguous-outcome hazard: NEVER auto retry a timed-out POST.
const { createCodingTask, getCodingTaskProgress, verifyMergedPullRequest } = proxyActivities<
  Pick<typeof activities, "createCodingTask" | "getCodingTaskProgress" | "verifyMergedPullRequest">
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
  let prNumber: number | null = null;
  setHandler(deliveryStatus, () => state);
  setHandler(reviewDeliveryPlan, (value, actorId) => {
    if (state.stage === "AWAITING_APPROVAL" && decision === null) {
      decision = value;
      state = { ...state, note: "人工决策："+value+"；操作人："+actorId };
    }
  });
  setHandler(requestPrVerification,(number,actorId)=>{
    if(state.stage==="AWAITING_PR_REVIEW"&&prNumber===null){
      prNumber=number;
      state={...state,note:"用户 "+actorId+" 请求验证 PR #"+number};
    }
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
  if (dispatch.outcome !== "ACCEPTED") return { ...state,
    stage: dispatch.outcome === "UNKNOWN" ? "NEEDS_RECONCILIATION" : "PROVIDER_REJECTED",
    note: dispatch.reason };
  state = { ...state, stage: "AGENT_RUNNING", externalTaskId: dispatch.taskId, note: "GitHub Coding Agent 执行中；PR 和 CI 尚未核验。" };


  // A bounded interval avoids unbounded event history; later use GitHub webhooks and Continue-as-New.
  let finished=false;
  for(let attempt=0;attempt<240;attempt++){
    await sleep("5 minutes");
    const progress=await getCodingTaskProgress(input.repository,dispatch.taskId);
    state={...state,lastCheckedAt:new Date().toISOString(),note:progress.note};
    if(progress.kind==="DONE"){
      finished=true;
      state={...state,stage:"AWAITING_PR_REVIEW",
        note:"Agent 完成后仍需核对合并 PR、需求关联和 GitHub Checks。"};
      break;
    }
    if(progress.kind==="FAILED")return {...state,stage:"FOLLOW_UP_REQUIRED",
      note:"Coding Agent 执行失败，未自动重新派发。"};
  }
  if(!finished)return {...state,stage:"FOLLOW_UP_REQUIRED",
    note:"自动轮询窗口结束，需人工核对外部状态。"};
  while(true){
    await condition(()=>prNumber!==null);
    const number=prNumber!;
    prNumber=null;
    state={...state,stage:"VERIFYING_PR",note:"正在调用 GitHub 核对 PR 与 CI…"};
    const result=await verifyMergedPullRequest(input.repository,number,input.requirementId);
    if(result.verified&&result.mergeSha)return {...state,stage:"AWAITING_TEST_RELEASE",reviewedPrUrl:result.url,
      reviewedMergeSha:result.mergeSha,
      note:result.note+"；等待下阶段 GitOps/Argo 验收。"};
    state={...state,stage:"AWAITING_PR_REVIEW",note:result.note};
  }
}

export {hostedReleaseWorkflow,verifiedHostedReleaseWorkflow} from './hosted-workflows';
export {directHostedReleaseWorkflow,verifiedDirectHostedReleaseWorkflow} from './hosted-direct-workflows';
