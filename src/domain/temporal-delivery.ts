import { Connection, WorkflowClient } from "@temporalio/client";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { codingTasks } from "@/db/schema";
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
  const {req}=await permittedOwner(actor,requirementId);
  const repository=await sourceRepo(req.appId!);
  const [legacy]=await db.select({id:codingTasks.id}).from(codingTasks)
    .where(eq(codingTasks.requirementId,req.id)).limit(1);
  if(legacy) throw new AppError(409,"coding_task_exists");
  const input: DeliveryInput = {
    requirementId:req.id,repository,title:req.title,description:req.description,
    type:req.type as DeliveryInput["type"],
  };
  const workflowId=workflowIdFor(req.id);
  return withClient(async client => {
    await client.start("deliveryWorkflow", {
      taskQueue: DELIVERY_QUEUE,workflowId,args:[input],
      workflowIdReusePolicy: 1, // REJECT_DUPLICATE (must not recreate after earlier completion).
    });
    return {state:"STARTED",workflowId,note:"Temporal 已受理工作流，等待 Worker 分析需求。"};
  });
}
export async function getDelivery(actor:Actor|null,requirementId:string) {
  await permittedOwner(actor,requirementId,true);
  const workflowId=workflowIdFor(requirementId);
  return withClient(async client=>{
    const handle=client.getHandle(workflowId);
    try {
      await handle.describe();
      const snapshot=await handle.query<DeliverySnapshot>("deliveryStatus");
      return {state:"RUNNING",workflowId,snapshot};
    } catch(error) {
      if(error instanceof Error && error.name==="WorkflowNotFoundError")
        return {state:"NOT_STARTED",workflowId,note:"该需求尚未启动 Temporal 工作流。"};
      throw error;
    }
  });
}
export async function reviewDelivery(actor:Actor|null,requirementId:string,decision:"APPROVE"|"REJECT") {
  await permittedOwner(actor,requirementId);
  const workflowId=workflowIdFor(requirementId);
  return withClient(async client=>{
    const handle=client.getHandle(workflowId);
    const snapshot=await handle.query<DeliverySnapshot>("deliveryStatus");
    if(snapshot.stage!=="AWAITING_APPROVAL")throw new AppError(409,"delivery_not_ready");
    await handle.signal("reviewDeliveryPlan",decision);
    return {state:"SIGNAL_ACCEPTED",workflowId,
      note:"Temporal 接受审批信号，工作流稍后推进。信号已送达不代表 Coding Agent 启动成功。"};
  });
}
