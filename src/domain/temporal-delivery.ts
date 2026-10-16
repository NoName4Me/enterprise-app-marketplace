import { Connection, WorkflowClient } from "@temporalio/client";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { codingTasks,hostedReleases } from "@/db/schema";
import { startHostedRelease } from "./hosted-release-service";
import { AppError } from "./app-errors";
import type { Actor } from "./actor";
import { permittedOwner, sourceRepo } from "./coding-agent-service";
import { DELIVERY_QUEUE, type DeliverySnapshot, type DeliveryInput } from "@/temporal/contracts";

const workflowIdFor = (requirementId:string) => "portal-delivery-" + requirementId;
async function withClient<T>(callback: (client: WorkflowClient) => Promise<T>):Promise<T> {
  let connection: Connection | undefined;
  try {
    connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS?.trim() || "127.0.0.1:7233" });
    return await callback(new WorkflowClient({connection, namespace:process.env.TEMPORAL_NAMESPACE?.trim()||"default"}));
  } catch(error) {
    if(error instanceof AppError) throw error;
    if(error instanceof Error && error.name === "WorkflowExecutionAlreadyStartedError") throw new AppError(409,"coding_task_exists");
    throw new AppError(503,"temporal_unavailable");
  } finally {
    await connection?.close();
  }
}

export async function startDelivery(actor: Actor|null, requirementId: string) {
  const {req,actorData}=await permittedOwner(actor,requirementId);
  const repository=await sourceRepo(req.appId!);
  // Business-level idempotency survives Temporal history retention and server replacement.
  // UNIQUE(requirement_id) already exists in P5 coding_tasks; do not create a second task.
  const [reserved]=await db.insert(codingTasks).values({
    requirementId:req.id,createdBy:actorData.id,repository,state:"REQUESTING",
  }).onConflictDoNothing().returning({id:codingTasks.id});
  if(!reserved)throw new AppError(409,"coding_task_exists");
  const input: DeliveryInput={
    requirementId:req.id,repository,title:req.title,description:req.description,
    type:req.type as DeliveryInput["type"],
  };
  const workflowId=workflowIdFor(req.id);
  try {
    const started=await withClient(async client=>{
      await client.start("deliveryWorkflow",{
        taskQueue:DELIVERY_QUEUE,workflowId,args:[input],
        workflowIdReusePolicy:"REJECT_DUPLICATE",
        workflowIdConflictPolicy:"FAIL",
      });
      return {state:"STARTED",workflowId,
        note:"Temporal 已受理，持久执行记录创建；下一步由 Worker 分析需求。"};
    });
    await db.update(codingTasks).set({state:"ACCEPTED",updatedAt:new Date()})
      .where(eq(codingTasks.id,reserved.id));
    return started;
  } catch(error) {
    // A timeout after start may mean Temporal already accepted the workflow.
    // Keep the reservation to prevent duplicates until an operator reconciles it.
    await db.update(codingTasks).set({state:"UNKNOWN",updatedAt:new Date()})
      .where(eq(codingTasks.id,reserved.id));
    throw error;
  }
}
export async function getDelivery(actor:Actor|null,requirementId:string) {
  await permittedOwner(actor,requirementId,true);
  const [reservation]=await db.select({
    state:codingTasks.state,externalTaskId:codingTasks.externalTaskId,
  }).from(codingTasks).where(eq(codingTasks.requirementId,requirementId)).limit(1);
  const workflowId=workflowIdFor(requirementId);
  // An older, direct Copilot task must never be mistaken for an unstarted Workflow.
  if(reservation?.externalTaskId)return {
    state:"LEGACY_EXTERNAL_TASK",workflowId,
    note:"该需求存在旧版直接 Copilot 任务："+reservation.externalTaskId+"；须先在 GitHub 人工核对，不能自动转为 Temporal 任务。",
  };
  const delivery=await withClient(async client=>{
    const handle=client.getHandle(workflowId);
    try {
      const description=await handle.describe();
      const snapshot=await handle.query<DeliverySnapshot>("deliveryStatus");
      return {state:description.status.name,workflowId,snapshot};
    } catch(error) {
      if(error instanceof Error && error.name==="WorkflowNotFoundError")
        return reservation
          ? {state:"NEEDS_RECONCILIATION",workflowId,note:"已有业务任务预约（"+reservation.state+"），但 Temporal 未找到执行；须人工核对再处理，不能重复派发。"}
          : {state:"NOT_STARTED",workflowId,note:"该需求尚未启动 Temporal 工作流。"};
      throw error;
    }
  });
  const releases=await db.select({id:hostedReleases.id,status:hostedReleases.status,
    imageDigest:hostedReleases.imageDigest,sourceSha:hostedReleases.sourceSha,
    versionLabel:hostedReleases.versionLabel,releaseNotes:hostedReleases.releaseNotes,
    updatedAt:hostedReleases.updatedAt})
    .from(hostedReleases).where(eq(hostedReleases.requirementId,requirementId))
    .orderBy(desc(hostedReleases.createdAt)).limit(10);
  return {...delivery,releases};
}
/** Explicit owner action. Never automatically deploy on PR merge or accept a SHA from the browser. */
export async function startDeliveryTestRelease(actor:Actor|null,requirementId:string){
  const {req}=await permittedOwner(actor,requirementId);
  const repository=await sourceRepo(req.appId!);
  const snapshot=await withClient(async client=>
    client.getHandle(workflowIdFor(req.id)).query<DeliverySnapshot>("deliveryStatus"));
  if(snapshot.stage!=="AWAITING_TEST_RELEASE"||
    snapshot.repository.toLowerCase()!==repository.toLowerCase()||
    !snapshot.reviewedMergeSha||!/^[a-f0-9]{40}$/.test(snapshot.reviewedMergeSha))
    throw new AppError(409,"delivery_test_not_ready");
  return startHostedRelease(actor,req.appId!,"TEST",null,{
    requirementId:req.id,requiredMergeSha:snapshot.reviewedMergeSha,repository});
}
export async function reviewDelivery(actor:Actor|null,requirementId:string,decision:"APPROVE"|"REJECT") {
  const {req,actorData}=await permittedOwner(actor,requirementId);
  const repository=await sourceRepo(req.appId!);
  const workflowId=workflowIdFor(requirementId);
  return withClient(async client=>{
    const handle=client.getHandle(workflowId);
    const snapshot=await handle.query<DeliverySnapshot>("deliveryStatus");
    if(snapshot.stage!=="AWAITING_APPROVAL" || snapshot.repository!==repository)
      throw new AppError(409,"delivery_not_ready");
    await handle.signal("reviewDeliveryPlan",decision,actorData.id);
    return {state:"SIGNAL_ACCEPTED",workflowId,
      note:"Temporal 接受审批信号，工作流稍后推进。信号已送达不代表 Coding Agent 启动成功。"};
  });
}

export async function verifyDeliveryPr(actor:Actor|null,requirementId:string,prNumber:number){
  const {req,actorData}=await permittedOwner(actor,requirementId);
  const repository=await sourceRepo(req.appId!);
  if(!Number.isSafeInteger(prNumber)||prNumber<1||prNumber>1_000_000_000)
    throw new AppError(422,"invalid_pr_number");
  const workflowId=workflowIdFor(requirementId);
  return withClient(async client=>{
    const handle=client.getHandle(workflowId);
    const snapshot=await handle.query<DeliverySnapshot>("deliveryStatus");
    if(snapshot.stage!=="AWAITING_PR_REVIEW"||snapshot.repository!==repository)
      throw new AppError(409,"delivery_not_ready");
    await handle.signal("requestPrVerification",prNumber,actorData.id);
    return {state:"SIGNAL_ACCEPTED",workflowId,
      note:"Temporal 接受 PR 核验请求，真实合并与 CI 结果需再次读取流程状态。"};
  });
}
