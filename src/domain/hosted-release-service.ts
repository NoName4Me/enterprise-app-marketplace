import {Connection,WorkflowClient} from "@temporalio/client";
import {and,desc,eq,inArray} from "drizzle-orm";
import {randomUUID} from "node:crypto";
import {db} from "@/db/client";
import {applications,appEnvironments,appHostedPorts,hostedReleases,requirements} from "@/db/schema";
import {authorizeActor,type Actor} from "./actor";
import {AppError} from "./app-errors";
import {DELIVERY_QUEUE} from "@/temporal/contracts";
import type {HostedReleaseInput,HostedReleaseSnapshot} from "@/temporal/hosted-contracts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST=/^ghcr\.io\/[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)+@sha256:[a-f0-9]{64}$/;
const running=["REQUESTING","BUILDING","WAITING_PR","DEPLOYING","NEEDS_RECONCILIATION"] as const;
function validateId(id:string){if(!UUID.test(id))throw new AppError(404,"not_found");}
function allowedRepo(repo:string){
  const all=(process.env.HOSTED_ALLOWED_REPOS??"").split(",").map(x=>x.toLowerCase().trim());
  return all.includes(repo.toLowerCase());
}
async function withClient<T>(callback:(client:WorkflowClient)=>Promise<T>):Promise<T>{
  let connection:Connection|undefined;
  try{
    connection=await Connection.connect({address:process.env.TEMPORAL_ADDRESS?.trim()||"127.0.0.1:7233"});
    return await callback(new WorkflowClient({connection,namespace:process.env.TEMPORAL_NAMESPACE?.trim()||"default"}));
  }finally{await connection?.close();}
}
export async function listHostedReleases(actor:Actor|null,appId:string){
  const user=await authorizeActor(actor,"active");
  validateId(appId);
  const [app]=await db.select({owner:applications.ownerUserId,kind:applications.sourceKind})
    .from(applications).where(eq(applications.id,appId));
  if(!app||app.owner!==user.id)throw new AppError(404,"not_found");
  if(app.kind!=="HOSTED")throw new AppError(422,"external_app_not_hosted");
  const rows=await db.select().from(hostedReleases)
    .where(eq(hostedReleases.appId,appId)).orderBy(desc(hostedReleases.createdAt)).limit(30);
  return {releases:rows.map(r=>({
    id:r.id,environment:r.environment,requirementId:r.requirementId,status:r.status,sourceSha:r.sourceSha,
    buildRunId:r.buildRunId,imageDigest:r.imageDigest,gitopsPrNumber:r.gitopsPrNumber,
    note:r.note,createdAt:r.createdAt,updatedAt:r.updatedAt
  }))};
}
export async function startHostedRelease(actor:Actor|null,appId:string,environment:unknown,testedReleaseId:unknown=null,
  linkage?:{requirementId:string;requiredMergeSha:string;repository:string}){
  if(linkage && (environment!=="TEST"||!UUID.test(linkage.requirementId)||
    !/^[a-f0-9]{40}$/.test(linkage.requiredMergeSha)))
    throw new AppError(422,"invalid_delivery_release_link");
  const user=await authorizeActor(actor,"create");
  validateId(appId);
  if(environment!=="TEST"&&environment!=="PRODUCTION")
    throw new AppError(422,"invalid_release_environment");
  if(environment==="PRODUCTION"){
    const allowed=new Set((process.env.P4_DEPLOY_OPERATOR_IDS??"").split(",").map(x=>x.trim()));
    if(!allowed.has(user.id))throw new AppError(403,"production_operator_required");
  }
  const current=await db.transaction(async tx=>{
    const [app]=await tx.select().from(applications)
      .where(eq(applications.id,appId)).for("update");
    if(!app||app.ownerUserId!==user.id)throw new AppError(404,"not_found");
    if(app.sourceKind!=="HOSTED"||!app.sourceRepository||app.lifecycleStatus==="RETIRED")
      throw new AppError(422,"not_deployable");
    if(!allowedRepo(app.sourceRepository))throw new AppError(403,"hosted_repository_not_allowed");
    if(linkage){
      if(app.sourceRepository.toLowerCase()!==linkage.repository.toLowerCase())
        throw new AppError(409,"delivery_repository_changed");
      const [req]=await tx.select({appId:requirements.appId}).from(requirements)
        .where(eq(requirements.id,linkage.requirementId)).limit(1);
      if(!req||req.appId!==appId)throw new AppError(422,"invalid_delivery_release_link");
    }
    const active=await tx.select({id:hostedReleases.id}).from(hostedReleases)
      .where(and(eq(hostedReleases.appId,appId),
        eq(hostedReleases.environment,environment),
        inArray(hostedReleases.status,[...running]))).limit(1);
    if(active.length)throw new AppError(409,"release_in_progress");
    const [port]=await tx.select().from(appHostedPorts).where(and(
      eq(appHostedPorts.appId,appId),eq(appHostedPorts.environment,environment))).limit(1);
    const [env]=await tx.select({id:appEnvironments.id}).from(appEnvironments).where(and(
      eq(appEnvironments.appId,appId),eq(appEnvironments.purpose,environment))).limit(1);
    if(!port||!env)throw new AppError(409,"hosted_environment_missing");
    let imageDigest:string|undefined;
    if(environment==="PRODUCTION"){
      // A selected historical TEST release also supports safe rollback.
      // Never accept a client-supplied digest or branch name.
      if(testedReleaseId!==null&&
        (typeof testedReleaseId!=="string"||!UUID.test(testedReleaseId)))
        throw new AppError(422,"invalid_tested_release");
      const ready=await tx.select({
        id:hostedReleases.id,digest:hostedReleases.imageDigest,
      }).from(hostedReleases).where(and(
        eq(hostedReleases.appId,appId),
        eq(hostedReleases.environment,"TEST"),eq(hostedReleases.status,"READY")
      )).orderBy(desc(hostedReleases.createdAt)).limit(30);
      const chosen=testedReleaseId===null?ready[0]:ready.find(x=>x.id===testedReleaseId);
      if(!chosen||!chosen.digest||!DIGEST.test(chosen.digest))
        throw new AppError(409,"test_release_not_verified");
      imageDigest=chosen.digest;
      if(port.state==="READY"&&port.imageDigest===imageDigest)
        throw new AppError(409,"production_already_on_tested_version");
    }
    const releaseId=randomUUID(),workflowId="hosted-release-"+releaseId;
    await tx.insert(hostedReleases).values({id:releaseId,appId,requestedBy:user.id,
      requirementId:linkage?.requirementId,
      environment,workflowId,note:"已受理发布请求，等待 Temporal"});
    const input:HostedReleaseInput={releaseId,appId,environment,environmentId:env.id,
      nodePort:port.nodePort,repository:app.sourceRepository,imageDigest,
      requiredMergeSha:linkage?.requiredMergeSha};
    return {input,workflowId};
  });
  // A timeout can happen AFTER the Temporal server accepted the start.
  // Keep the unique release row and demand operator reconciliation, never dispatch twice.
  try{
    await withClient(async client=>{
      await client.start("hostedReleaseWorkflow",{
        workflowId:current.workflowId,taskQueue:DELIVERY_QUEUE,args:[current.input],
        workflowIdReusePolicy:"REJECT_DUPLICATE",workflowIdConflictPolicy:"FAIL"
      });
    });
    return {releaseId:current.input.releaseId,workflowId:current.workflowId,status:"REQUESTING"};
  }catch{
    await db.update(hostedReleases).set({
      status:"NEEDS_RECONCILIATION",note:"Temporal 启动结果不确定，请先核对是否已执行",
      updatedAt:new Date()
    }).where(eq(hostedReleases.id,current.input.releaseId));
    throw new AppError(503,"release_start_unknown");
  }
}
export async function inspectHostedRelease(actor:Actor|null,appId:string,releaseId:string){
  const listed=await listHostedReleases(actor,appId);
  validateId(releaseId);
  const release=listed.releases.find(x=>x.id===releaseId);
  if(!release)throw new AppError(404,"not_found");
  try{
    const snapshot=await withClient(client=>
      client.getHandle("hosted-release-"+releaseId).query<HostedReleaseSnapshot>("hostedReleaseStatus"));
    return {release,snapshot};
  }catch{
    return {release,snapshot:null,note:"Temporal 当前不可读；仅显示数据库最后一次确认的发布状态"};
  }
}
