import {eq,and} from "drizzle-orm";
import {db} from "../db/client";
import {hostedReleases,appHostedPorts} from "../db/schema";
import type {HostedReleaseInput,HostedReleaseSnapshot,ExternalAction,BuildProgress,GitopsResult} from "./hosted-contracts";
import {renderHostedManifest} from "../../scripts/p4-hosted-manifest.mjs";
import {trustedRun,trustedBuildImage} from "./hosted-proof";

const githubApi="https://api.github.com";
const gitopsRepo="NoName4Me/enterprise-app-marketplace";
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
    snapshot.stage==="AWAITING_PR"||snapshot.stage==="OPENING_PR"?"WAITING_PR":"DEPLOYING";
  await db.transaction(async tx=>{
    const [release]=await tx.update(hostedReleases).set({
      status,sourceSha:snapshot.sourceSha,buildRunId:snapshot.buildRunId,
      imageDigest:snapshot.imageDigest,gitopsPrNumber:snapshot.gitopsPrNumber,
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
    } else if(status==="DEPLOYING"||status==="WAITING_PR"){
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
    const head=await gh("/repos/"+input.repository+"/branches/"+encodeURIComponent(branch),access);
    if(!head.ok)return {kind:"REJECTED",reason:"无法确认默认分支 SHA"};
    const sha=str(value((await json(head)).commit).sha);
    if(!SHA.test(sha))return {kind:"REJECTED",reason:"代码 Commit 无效"};
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

export async function openHostedGitopsPr(input:HostedReleaseInput,image:string):Promise<GitopsResult>{
  const access=token("HOSTED_GITOPS_TOKEN");
  if(!access)return {kind:"REJECTED",reason:"缺少 HOSTED_GITOPS_TOKEN"};
  if(!DIGEST.test(image)||!UUID.test(input.releaseId))
    return {kind:"REJECTED",reason:"发布输入缺少可信不可变镜像"};
  // Explicitly bind production to an already verified TEST digest.
  if(input.environment==="PRODUCTION"&&image!==input.imageDigest)
    return {kind:"REJECTED",reason:"生产镜像与测试版本不一致"};
  const manifest=renderHostedManifest({
    appId:input.appId,environmentId:input.environmentId,environment:input.environment,
    image,repo:input.repository,nodePort:input.nodePort
  });
  const env=input.environment.toLowerCase(),prefix="p4/gitops/hosted/"+input.appId+"/"+env;
  const branch="hosted/release/"+input.releaseId;
  const contents=[
    {path:prefix+"/resources.yaml",content:manifest.workload},
    {path:prefix+"/kustomization.yaml",content:"apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - resources.yaml\n"},
  ];
  try{
    const ref=await gh("/repos/"+gitopsRepo+"/git/ref/heads/dev",access);
    if(!ref.ok)return {kind:"REJECTED",reason:"无法读取 GitOps dev 基线"};
    const sha=str(value((await json(ref)).object).sha);
    if(!SHA.test(sha))return {kind:"REJECTED",reason:"GitOps 基线 Commit 无效"};
    const base=await gh("/repos/"+gitopsRepo+"/git/commits/"+sha,access);
    if(!base.ok)return {kind:"REJECTED",reason:"无法读取 GitOps Tree"};
    const treeSha=str(value((await json(base)).tree).sha);
    if(!SHA.test(treeSha))return {kind:"REJECTED",reason:"GitOps Tree 无效"};
    const tree=await gh("/repos/"+gitopsRepo+"/git/trees",access,{
      method:"POST",body:JSON.stringify({base_tree:treeSha,
        tree:contents.map(x=>({path:x.path,mode:"100644",type:"blob",content:x.content}))})
    });
    if(!tree.ok)return {kind:"REJECTED",reason:"GitOps 创建 Tree 失败"};
    const target=str((await json(tree)).sha);
    if(!SHA.test(target))return {kind:"UNKNOWN",reason:"GitOps Tree 返回不确定"};
    const commit=await gh("/repos/"+gitopsRepo+"/git/commits",access,{
      method:"POST",body:JSON.stringify({tree:target,parents:[sha],
        message:"feat(release): 托管应用 "+input.appId+" "+input.environment+" "+input.releaseId})
    });
    if(!commit.ok)return {kind:"UNKNOWN",reason:"GitOps Commit 创建结果未知"};
    const newSha=str((await json(commit)).sha);
    if(!SHA.test(newSha))return {kind:"UNKNOWN",reason:"GitOps Commit 无效"};
    const created=await gh("/repos/"+gitopsRepo+"/git/refs",access,{
      method:"POST",body:JSON.stringify({ref:"refs/heads/"+branch,sha:newSha})
    });
    if(created.status!==201)return {kind:"UNKNOWN",reason:"分支可能已创建，请检查 "+branch+"；停止自动重试"};
    const pr=await gh("/repos/"+gitopsRepo+"/pulls",access,{
      method:"POST",body:JSON.stringify({title:"feat(release): 托管应用"+
        (input.environment==="TEST"?"测试":"生产")+"发布 "+input.appId,
        head:branch,base:"dev",
        body:"Portal-Release-ID: "+input.releaseId+"\nSource: "+input.repository+
          "\nImage: "+image+"\n\n请审核镜像来源、NodePort 和命名空间；合并后才允许 Argo 同步。"})
    });
    if(pr.status!==201)return {kind:"UNKNOWN",reason:"PR 创建结果不明确，请检查分支 "+branch};
    const number=num((await json(pr)).number);
    if(!Number.isSafeInteger(number)||number<1)return {kind:"UNKNOWN",reason:"PR 编号无效"};
    return {kind:"ACCEPTED",prNumber:number};
  }catch{return {kind:"UNKNOWN",reason:"GitOps API 超时，可能已创建分支或 PR；请人工核对"};}
}

export async function checkGitopsPr(input:HostedReleaseInput,number:number,image:string):
Promise<"WAIT"|"MERGED"|"CLOSED">{
  const access=token("HOSTED_GITOPS_TOKEN");
  if(!access||!DIGEST.test(image))return "WAIT";
  try{
    const response=await gh("/repos/"+gitopsRepo+"/pulls/"+number,access);
    if(!response.ok)return "WAIT";
    const pr=await json(response);
    if(str(value(pr.head).ref)!=="hosted/release/"+input.releaseId ||
       str(value(pr.base).ref)!=="dev")return "WAIT";
    if(pr.merged!==true)return pr.state==="closed"?"CLOSED":"WAIT";
    const path="p4/gitops/hosted/"+input.appId+"/"+input.environment.toLowerCase()+"/resources.yaml";
    const content=await gh("/repos/"+gitopsRepo+"/contents/"+path+"?ref=dev",access);
    if(!content.ok)return "WAIT";
    const blob=await json(content);
    if(blob.encoding!=="base64"||typeof blob.content!=="string")return "WAIT";
    const text=Buffer.from(blob.content,"base64").toString("utf8");
    return text.includes("          image: "+image)?"MERGED":"WAIT";
  }catch{return "WAIT";}
}

function argoUrl():URL|null{
  const input=process.env.ARGOCD_SERVER_URL?.trim();
  if(!input)return null;
  try{
    const url=new URL(input);
    if(url.username||url.password||url.search||url.hash)return null;
    if(url.protocol==="https:"||url.protocol==="http:"&&
       ["localhost","127.0.0.1","argocd-server.argocd.svc.cluster.local"].includes(url.hostname))return url;
    return null;
  }catch{return null;}
}
async function argo(path:string,init:RequestInit={}):Promise<Response>{
  const url=argoUrl(),access=token("HOSTED_ARGO_APPLICATION_TOKEN");
  if(!url||!access)throw new Error("argo_not_configured");
  url.pathname=url.pathname.replace(/\/$/,"")+path;
  return fetch(url,{...init,headers:{
    Authorization:"Bearer "+access,Accept:"application/json","Content-Type":"application/json",
  },cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)});
}

export async function registerHostedArgoApp(input:HostedReleaseInput):Promise<ExternalAction>{
  const ns="hosted-"+input.appId.replaceAll("-","")+"-"+input.environment.toLowerCase();
  const application={
    apiVersion:"argoproj.io/v1alpha1",kind:"Application",
    metadata:{name:ns,namespace:"argocd",labels:{
      "marketplace-app-id":input.appId,"marketplace-environment-id":input.environmentId}},
    spec:{project:"marketplace-hosted",source:{
      repoURL:"https://github.com/"+gitopsRepo+".git",targetRevision:"dev",
      path:"p4/gitops/hosted/"+input.appId+"/"+input.environment.toLowerCase()},
    destination:{server:"https://kubernetes.default.svc",namespace:ns},
    syncPolicy:{automated:{prune:false,selfHeal:true},syncOptions:["CreateNamespace=true"]}}
  };
  try{
    const response=await argo("/api/v1/applications",{method:"POST",
      body:JSON.stringify({application})});
    if(!response.ok&&response.status!==409)
      return {kind:response.status<500?"REJECTED":"UNKNOWN",
        reason:"Argo 不接受应用注册，请核对 Project/Token 权限："+response.status};
    const current=await argo("/api/v1/applications/"+ns);
    if(!current.ok)return {kind:"UNKNOWN",reason:"Argo 应用可能已创建，但暂不可读"};
    const data=await json(current),spec=value(data.spec),source=value(spec.source);
    if(str(spec.project)!=="marketplace-hosted"||
      str(source.path)!==application.spec.source.path||
      str(value(spec.destination).namespace)!==ns)
      return {kind:"REJECTED",reason:"已存在同名但不属于当前应用的 Argo Application"};
    return {kind:"ACCEPTED",id:ns};
  }catch{return {kind:"UNKNOWN",reason:"Argo 应用注册网络异常，需人工核对"};}
}

export async function probeHostedArgo(input:HostedReleaseInput,image:string):
Promise<{ready:boolean;note:string}>{
  const ns="hosted-"+input.appId.replaceAll("-","")+"-"+input.environment.toLowerCase();
  try{
    const response=await argo("/api/v1/applications/"+ns);
    if(!response.ok)return {ready:false,note:"Argo Application 不可读"};
    const app=await json(response),status=value(app.status),meta=value(app.metadata);
    const labels=value(meta.labels);
    const sync=value(status.sync),health=value(status.health),summary=value(status.summary);
    if(labels["marketplace-app-id"]!==input.appId ||
      labels["marketplace-environment-id"]!==input.environmentId ||
      sync.status!=="Synced"||health.status!=="Healthy"||
      !Array.isArray(summary.images)||!summary.images.includes(image))
      return {ready:false,note:"Argo 未确认应用归属、Synced/Healthy 或镜像 Digest"};
    // A successful HTTP GET on an occupied NodePort is not sufficient:
    // prove the Service belongs to this app and uses its RESERVED port.
    const resourcePath="/api/v1/applications/"+ns+"/resource?"+
      new URLSearchParams({namespace:ns,resourceName:"web",version:"v1",kind:"Service"}).toString();
    const serviceResponse=await argo(resourcePath);
    if(!serviceResponse.ok)return {ready:false,note:"无法读取 Argo 已同步的 Service"};
    const resource=await json(serviceResponse);
    const rawManifest=str(resource.manifest);
    if(!rawManifest||rawManifest.length>24000)return {ready:false,note:"Service 资源清单不可读"};
    const service=value(JSON.parse(rawManifest) as unknown);
    const spec=value(service.spec),metaService=value(service.metadata);
    const ports=Array.isArray(spec.ports)?spec.ports:[];
    if(metaService.name!=="web"||metaService.namespace!==ns||
      spec.type!=="NodePort"||value(spec.selector).app!=="web"||
      !ports.some(p=>num(value(p).nodePort)===input.nodePort))
      return {ready:false,note:"实际 Service 归属或 NodePort 与平台预约不一致"};
    const ip=token("HOSTED_PUBLIC_IP").split(".").map(Number);
    if(ip.length!==4||ip.some(n=>!Number.isInteger(n)||n<0||n>255)||
       !(ip[0]===10||(ip[0]===172&&ip[1]>=16&&ip[1]<=31)||
         (ip[0]===192&&ip[1]===168)))
      return {ready:false,note:"未设置受限于内网的固定 IP"};
    const result=await fetch("http://"+ip.join(".")+":"+input.nodePort+"/",{
      redirect:"error",cache:"no-store",signal:AbortSignal.timeout(6000)});
    await result.body?.cancel();
    return result.ok?{ready:true,note:"Argo 与 Pod 入口验证成功"}:
      {ready:false,note:"Pod 入口 HTTP 尚未成功"};
  }catch{return {ready:false,note:"运行网络或 Argo 状态暂不可用"};}
}
