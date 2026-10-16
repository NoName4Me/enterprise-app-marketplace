import {eq,and} from "drizzle-orm";
import {db} from "../db/client";
import {hostedReleases,appHostedPorts} from "../db/schema";
import type {HostedReleaseInput,HostedReleaseSnapshot,ExternalAction,BuildProgress} from "./hosted-contracts";
import {trustedRun,trustedBuildImage,trustedMergeAncestry} from "./hosted-proof";

const githubApi="https://api.github.com";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^ghcr\.io\/[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)+@sha256:[a-f0-9]{64}$/;
const validRepo=(s:string)=>/^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9_.-]{1,100}$/.test(s)&&!s.endsWith("/.")&&!s.endsWith("/..");
function headers(token:string) {return {
  Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
  "X-GitHub-Api-Version":"2026-03-10","Content-Type":"application/json",
};}
function token(name:string){return process.env[name]?.trim()??"";}
async function gh(path:string,access:string,init:RequestInit={}):Promise<Response>{
  return fetch(githubApi+path,{...init,headers:{...headers(access),...init.headers},
    redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
}
async function json(r:Response):Promise<Record<string,unknown>>{
  const data=await r.json() as unknown;
  return data && typeof data==="object"&&!Array.isArray(data)?data as Record<string,unknown>:{};
}
const value=(x:unknown)=>x&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:{};
const str=(x:unknown)=>typeof x==="string"?x:"";
const num=(x:unknown)=>typeof x==="number"?x:Number(x);

export async function recordHostedRelease(snapshot:HostedReleaseSnapshot):Promise<void>{
  if(!UUID.test(snapshot.releaseId))throw new Error("release_id");
  const status=snapshot.stage==="READY"?"READY":
    snapshot.stage==="NEEDS_RECONCILIATION"?"NEEDS_RECONCILIATION":
    snapshot.stage==="FAILED"?"FAILED":
    snapshot.stage==="BUILDING"||snapshot.stage==="WAITING_BUILD"?"BUILDING":
    "DEPLOYING";
  await db.transaction(async tx=>{
    const [release]=await tx.update(hostedReleases).set({
      status,sourceSha:snapshot.sourceSha,buildRunId:snapshot.buildRunId,
      imageDigest:snapshot.imageDigest,
      note:snapshot.note.slice(0,500),updatedAt:new Date()
    }).where(eq(hostedReleases.id,snapshot.releaseId))
      .returning({appId:hostedReleases.appId,environment:hostedReleases.environment});
    if(!release)throw new Error("release_row_missing");
    if(status==="READY"){
      if(!snapshot.imageDigest||!DIGEST.test(snapshot.imageDigest))throw new Error("digest_not_trusted");
      if(release.environment==="PRODUCTION"){
        // Production can promote or roll back to any historically VERIFIED TEST digest.
        // A malicious actor cannot inject an arbitrary tag through the client.
        const [tested]=await tx.select({id:hostedReleases.id})
          .from(hostedReleases).where(and(
            eq(hostedReleases.appId,release.appId),
            eq(hostedReleases.environment,"TEST"),
            eq(hostedReleases.status,"READY"),
            eq(hostedReleases.imageDigest,snapshot.imageDigest)
          )).limit(1);
        if(!tested)throw new Error("no_verified_test_digest");
      }
      await tx.update(appHostedPorts).set({
        state:"READY",imageDigest:snapshot.imageDigest,verifiedAt:new Date(),updatedAt:new Date()
      }).where(and(eq(appHostedPorts.appId,release.appId),
        eq(appHostedPorts.environment,release.environment)));
    } else if(status==="DEPLOYING"){
      // Keep an already-verified live release accessible during an upgrade.
      // Do not replace its READY pointer until the new digest is proven healthy.
      await tx.update(appHostedPorts).set({state:"DEPLOYING",updatedAt:new Date()})
        .where(and(eq(appHostedPorts.appId,release.appId),
          eq(appHostedPorts.environment,release.environment),
          eq(appHostedPorts.state,"RESERVED")));
    }
    // Keep previously verified endpoints available on a failed upgrade,
    // until the system has evidence they are actually unhealthy.
  });
}

export async function dispatchHostedBuild(input:HostedReleaseInput):Promise<ExternalAction>{
  if(!validRepo(input.repository)||!UUID.test(input.appId))
    return {kind:"REJECTED",reason:"仓库或应用标识无效"};
  const access=token("HOSTED_GITHUB_SOURCE_TOKEN");
  if(!access)return {kind:"REJECTED",reason:"缺少 HOSTED_GITHUB_SOURCE_TOKEN"};
  let dispatchStarted=false;
  try{
    const repo=await gh("/repos/"+input.repository,access);
    if(!repo.ok)return {kind:"REJECTED",reason:"源仓库访问失败或权限不足"};
    const info=await json(repo),branch=str(info.default_branch);
    if(!/^[a-zA-Z0-9._/-]{1,120}$/.test(branch)||branch.includes(".."))
      return {kind:"REJECTED",reason:"仓库默认分支不受支持"};
    const selected=input.sourceRef??branch;
    const head=await gh("/repos/"+input.repository+"/commits/"+encodeURIComponent(selected),access);
    if(!head.ok)return {kind:"REJECTED",reason:"无法在该应用仓库解析指定分支或 Commit"};
    const sha=str((await json(head)).sha);
    if(!SHA.test(sha))return {kind:"REJECTED",reason:"代码 Commit 无效"};
    if(input.requiredMergeSha){
      // P5 handoff must deploy an actual descendant of the verified PR merge.
      if(!SHA.test(input.requiredMergeSha))
        return {kind:"REJECTED",reason:"需求交付来源 SHA 无效"};
      const compare=await gh("/repos/"+input.repository+"/compare/"+
        input.requiredMergeSha+"..."+sha,access);
      if(!compare.ok||!trustedMergeAncestry(await json(compare),input.requiredMergeSha,sha))
        return {kind:"REJECTED",reason:"所选版本不包含已审核需求的合并提交；拒绝关联交付"};
    }
    const wf=await gh("/repos/"+input.repository+"/actions/workflows/marketplace-build.yml",access);
    if(!wf.ok)return {kind:"REJECTED",reason:"源仓库尚未安装 marketplace-build.yml 标准构建工作流"};
    dispatchStarted=true;
    const result=await gh("/repos/"+input.repository+"/actions/workflows/marketplace-build.yml/dispatches",access,{
      method:"POST",
      body:JSON.stringify({ref:branch,return_run_details:true,inputs:{
        app_id:input.appId,source_sha:sha
      }})
    });
    if(result.status===400||result.status===401||result.status===403||result.status===404||result.status===422)
      return {kind:"REJECTED",reason:"GitHub 拒绝构建派发，请检查 workflow_dispatch 与 Actions 写权限"};
    if(result.status!==200)return {kind:"UNKNOWN",reason:"构建派发结果未知；禁止自动重复派发"};
    const body=await json(result),id=num(body.workflow_run_id);
    if(!Number.isSafeInteger(id)||id<1)return {kind:"UNKNOWN",reason:"GitHub 未返回可识别的 Workflow Run ID"};
    return {kind:"ACCEPTED",id:String(id),sourceSha:sha};
  }catch{return dispatchStarted
    ?{kind:"UNKNOWN",reason:"网络超时，构建可能已开始；请在源仓库 Actions 核查"}
    :{kind:"REJECTED",reason:"GitHub 只读接入检查失败，尚未派发构建；请检查 Worker 网络"};}
}

export async function pollHostedBuild(input:HostedReleaseInput,runId:string,sourceSha:string):Promise<BuildProgress>{
  const access=token("HOSTED_GITHUB_SOURCE_TOKEN");
  if(!access||!validRepo(input.repository)||!/^[1-9][0-9]{0,18}$/.test(runId)||!SHA.test(sourceSha))
    return {kind:"FAILED",reason:"无效构建标识或凭据"};
  try{
    const runResponse=await gh("/repos/"+input.repository+"/actions/runs/"+runId,access);
    if(!runResponse.ok)return {kind:"WAIT"};
    const run=await json(runResponse);
    if(run.status!=="completed")return {kind:"WAIT"};
    if(!trustedRun(run))
      return {kind:"FAILED",reason:"构建失败或工作流身份不符合受信来源"};
    const response=await gh("/repos/"+input.repository+"/deployments?sha="+sourceSha+
      "&environment=marketplace-build-artifact&per_page=100",access);
    if(!response.ok)return {kind:"WAIT"};
    const items=await response.json() as unknown;
    const image=trustedBuildImage(items,{
      repository:input.repository,appId:input.appId,sha:sourceSha,runId
    });
    if(!image)return {kind:"WAIT"};
    return {kind:"READY",imageDigest:image};
  }catch{return {kind:"WAIT"};}
}
