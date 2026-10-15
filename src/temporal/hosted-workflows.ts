import { defineQuery, proxyActivities, setHandler, sleep } from "@temporalio/workflow";
import type * as hosted from "./hosted-activities";
import type {HostedReleaseInput,HostedReleaseSnapshot} from "./hosted-contracts";

export const hostedReleaseStatus=defineQuery<HostedReleaseSnapshot>("hostedReleaseStatus");
// Never retry a remote POST of unknown outcome. DB status updates are idempotent.
const {dispatchHostedBuild,openHostedGitopsPr,registerHostedArgoApp}=proxyActivities<
  Pick<typeof hosted,"dispatchHostedBuild"|"openHostedGitopsPr"|"registerHostedArgoApp">
>({startToCloseTimeout:"45 seconds",retry:{maximumAttempts:1}});
const {pollHostedBuild,checkGitopsPr,probeHostedArgo}=proxyActivities<
  Pick<typeof hosted,"pollHostedBuild"|"checkGitopsPr"|"probeHostedArgo">
>({startToCloseTimeout:"30 seconds",retry:{maximumAttempts:2}});
const {recordHostedRelease}=proxyActivities<Pick<typeof hosted,"recordHostedRelease">>({
  startToCloseTimeout:"15 seconds",retry:{maximumAttempts:5}
});

export async function hostedReleaseWorkflow(input:HostedReleaseInput):Promise<HostedReleaseSnapshot>{
  let state:HostedReleaseSnapshot={releaseId:input.releaseId,stage:"QUEUED",note:"等待持久任务",
    sourceSha:null,buildRunId:null,imageDigest:input.imageDigest??null,
    gitopsPrNumber:null,testedAt:null};
  setHandler(hostedReleaseStatus,()=>state);
  async function move(stage:HostedReleaseSnapshot["stage"],note:string){
    state={...state,stage,note};
    await recordHostedRelease(state);
  }
  try{
    if(input.environment==="TEST"){
      await move("BUILDING","请求源仓库的受控 GitHub Actions 构建");
      const result=await dispatchHostedBuild(input);
      if(result.kind!=="ACCEPTED"){
        await move(result.kind==="UNKNOWN"?"NEEDS_RECONCILIATION":"FAILED",result.reason);
        return state;
      }
      state={...state,sourceSha:result.sourceSha!,buildRunId:result.id};
      await move("WAITING_BUILD","GitHub Actions 正在构建并发布不可变 GHCR 镜像");
      let ready=false;
      for(let i=0;i<120;i++){
        await sleep("1 minute");
        const progress=await pollHostedBuild(input,result.id,result.sourceSha!);
        if(progress.kind==="FAILED"){await move("FAILED",progress.reason);return state;}
        if(progress.kind==="READY"){
          state={...state,imageDigest:progress.imageDigest};
          ready=true;break;
        }
      }
      if(!ready){await move("NEEDS_RECONCILIATION","超过两小时仍未取得可信构建结果，未部署");return state;}
    }
    if(!state.imageDigest){await move("FAILED","缺少不可变 GHCR 镜像");return state;}
    await move("OPENING_PR","创建 GitOps 变更 PR；不会直接操作 Kubernetes");
    const pr=await openHostedGitopsPr(input,state.imageDigest);
    if(pr.kind!=="ACCEPTED"){
      await move(pr.kind==="UNKNOWN"?"NEEDS_RECONCILIATION":"FAILED",pr.reason);
      return state;
    }
    state={...state,gitopsPrNumber:pr.prNumber};
    await move("AWAITING_PR","等待有权人员审核并合并 GitOps PR");
    let merged=false;
    for(let i=0;i<1008;i++){
      await sleep("10 minutes");
      const prResult=await checkGitopsPr(input,pr.prNumber,state.imageDigest!);
      if(prResult==="CLOSED"){await move("FAILED","GitOps PR 已关闭但未合并");return state;}
      if(prResult==="MERGED"){merged=true;break;}
    }
    if(!merged){await move("NEEDS_RECONCILIATION","超过观察窗口，GitOps PR 状态待核对");return state;}
    await move("SYNCING","GitOps 已合并；正在注册应用并等待 Argo CD 实际同步");
    const registration=await registerHostedArgoApp(input);
    if(registration.kind!=="ACCEPTED"){
      await move(registration.kind==="UNKNOWN"?"NEEDS_RECONCILIATION":"FAILED",registration.reason);
      return state;
    }
    await move("VERIFYING","验证 Argo CD 实际健康、镜像 Digest 和应用 NodePort");
    for(let i=0;i<60;i++){
      await sleep("1 minute");
      const health=await probeHostedArgo(input,state.imageDigest!);
      if(health.ready){
        state={...state,testedAt:new Date().toISOString()};
        await move("READY","Argo 已同步且从工作节点访问 NodePort 成功；仍须 Mac 客户端确认 LAN 可达");
        return state;
      }
    }
    await move("NEEDS_RECONCILIATION","Argo/NodePort 在一小时内未通过验证，不标记 READY");
  }catch{
    await move("NEEDS_RECONCILIATION","外部请求可能已完成但响应或 Worker 状态未知；停止自动重试并核对 GitHub/Argo");
  }
  return state;
}
