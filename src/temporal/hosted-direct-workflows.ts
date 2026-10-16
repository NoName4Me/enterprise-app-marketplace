import {defineQuery,proxyActivities,setHandler,sleep} from "@temporalio/workflow";
import type * as hosted from "./hosted-activities";
import type * as kube from "./hosted-kubernetes";
import type {HostedReleaseInput,HostedReleaseSnapshot} from "./hosted-contracts";

// New workflow type: old GitOps histories continue replaying without code-path changes.
const statusQuery=defineQuery<HostedReleaseSnapshot>("hostedReleaseStatus");
const {dispatchHostedBuild}=proxyActivities<Pick<typeof hosted,"dispatchHostedBuild">>({
  startToCloseTimeout:"90 seconds",retry:{maximumAttempts:1}
});
const {pollHostedBuild}=proxyActivities<Pick<typeof hosted,"pollHostedBuild">>({
  startToCloseTimeout:"30 seconds",retry:{maximumAttempts:2}
});
const {recordHostedRelease}=proxyActivities<Pick<typeof hosted,"recordHostedRelease">>({
  startToCloseTimeout:"15 seconds",retry:{maximumAttempts:5}
});
const {preflightHostedKube,applyHostedKube}=proxyActivities<
  Pick<typeof kube,"preflightHostedKube"|"applyHostedKube">>({
  startToCloseTimeout:"90 seconds",retry:{maximumAttempts:1}
});
const {probeHostedKube}=proxyActivities<Pick<typeof kube,"probeHostedKube">>({
  startToCloseTimeout:"30 seconds",retry:{maximumAttempts:2}
});
export async function verifiedDirectHostedReleaseWorkflow(input:HostedReleaseInput){
  if(input.environment!=="TEST"||!/^[a-f0-9]{40}$/.test(input.requiredMergeSha??""))
    throw new Error("verified_handoff_required");
  return directHostedReleaseWorkflow(input);
}
export async function directHostedReleaseWorkflow(input:HostedReleaseInput):Promise<HostedReleaseSnapshot>{
  let state:HostedReleaseSnapshot={releaseId:input.releaseId,stage:"QUEUED",
    note:"等待受控的直接 Kubernetes 发布",sourceSha:null,buildRunId:null,
    imageDigest:input.imageDigest??null,gitopsPrNumber:null,testedAt:null};
  setHandler(statusQuery,()=>state);
  async function move(stage:HostedReleaseSnapshot["stage"],note:string){
    state={...state,stage,note};await recordHostedRelease(state);
  }
  try{
    // Verify that a previous Argo controller has relinquished ownership BEFORE any build or write.
    const preflight=await preflightHostedKube(input);
    if(preflight.kind!=="ACCEPTED"){
      await move("FAILED",preflight.reason);return state;
    }
    if(input.environment==="TEST"){
      await move("BUILDING","获取源码并请求 GitHub Actions 构建");
      const build=await dispatchHostedBuild(input);
      if(build.kind!=="ACCEPTED"){
        await move(build.kind==="UNKNOWN"?"NEEDS_RECONCILIATION":"FAILED",build.reason);
        return state;
      }
      state={...state,sourceSha:build.sourceSha!,buildRunId:build.id};
      await move("WAITING_BUILD","等待 GitHub Actions 构建、冒烟测试与 GHCR 镜像");
      let complete=false;
      for(let attempt=0;attempt<240;attempt++){
        await sleep("30 seconds");
        const result=await pollHostedBuild(input,build.id,build.sourceSha!);
        if(result.kind==="FAILED"){await move("FAILED",result.reason);return state;}
        if(result.kind==="READY"){state={...state,imageDigest:result.imageDigest};complete=true;break;}
      }
      if(!complete){await move("NEEDS_RECONCILIATION","两小时仍未取得可信构建结果，需人工核查");return state;}
    }
    if(!state.imageDigest){await move("FAILED","缺少不可变镜像 Digest");return state;}
    await move("SYNCING","将经过验证的镜像直接提交到应用的 Kubernetes 环境");
    const deployed=await applyHostedKube(input,state.imageDigest);
    if(deployed.kind!=="ACCEPTED"){
      await move(deployed.kind==="UNKNOWN"?"NEEDS_RECONCILIATION":"FAILED",deployed.reason);
      return state;
    }
    await move("VERIFYING","验证实际 Deployment、镜像、Service 和 HTTP 访问");
    for(let attempt=0;attempt<120;attempt++){
      await sleep("30 seconds");
      const health=await probeHostedKube(input,state.imageDigest);
      if(health.ready){
        state={...state,testedAt:new Date().toISOString()};
        await move("READY","Kubernetes 镜像/Pod/Service 和工作节点 HTTP 验证成功；仍须独立 LAN 验证");
        return state;
      }
    }
    await move("NEEDS_RECONCILIATION","一小时内仍未完成 Kubernetes/HTTP 验证，需人工核对");
  }catch{
    await move("NEEDS_RECONCILIATION","外部发布操作可能已执行；禁止自动重复写入，需核对 Kubernetes 实际状态");
  }
  return state;
}
