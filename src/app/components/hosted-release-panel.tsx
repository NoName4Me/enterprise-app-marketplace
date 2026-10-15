"use client";
import {useCallback,useEffect,useState} from "react";
import {useRouter} from "next/navigation";

type Release={
  id:string;environment:"TEST"|"PRODUCTION";
  status:"REQUESTING"|"BUILDING"|"WAITING_PR"|"DEPLOYING"|"READY"|"FAILED"|"NEEDS_RECONCILIATION";
  sourceSha:string|null;buildRunId:string|null;
  imageDigest:string|null;gitopsPrNumber:number|null;
  note:string;createdAt:string;updatedAt:string;
};
const labels={
  REQUESTING:"任务已提交",BUILDING:"正在构建镜像",
  WAITING_PR:"等待 GitOps 审核",DEPLOYING:"正在部署与验证",
  READY:"已通过部署验证",FAILED:"部署未完成",NEEDS_RECONCILIATION:"需要人工核对"
};
const active=(status:Release["status"])=>["REQUESTING","BUILDING","WAITING_PR","DEPLOYING"].includes(status);
function errorDescription(error:string){
  const reasons:Record<string,string>={
    production_operator_required:"只有经过授权的生产发布负责人可以执行此操作。",
    hosted_repository_not_allowed:"仓库尚未加入平台管理员的托管仓库白名单。",
    test_release_not_verified:"测试环境尚未验证通过，不能直接发布生产。",
    release_in_progress:"此环境已有正在执行的发布任务，请先查看进度。",
    production_already_on_tested_version:"生产环境已经运行这一测试版本。",
    release_start_unknown:"Temporal 启动结果无法确定，请先核对发布记录，不要重复提交。"
  };
  return reasons[error]??"操作未成功，请检查仓库接入、授权和当前部署状态。";
}
export function HostedReleasePanel({root,repo,productionDigest}:{
  root:string;repo:string;productionDigest:string|null;
}){
  const router=useRouter();
  const [rows,setRows]=useState<Release[]>([]);
  const [busy,setBusy]=useState(false);
  const [selectedTestId,setSelectedTestId]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const refresh=useCallback(async()=>{
    try{
      const response=await fetch(root+"/hosted/releases",{cache:"no-store"});
      if(!response.ok)throw new Error("无法读取发布记录");
      const value=await response.json() as {releases:Release[]};
      setRows(value.releases);
      setError("");
    }catch{setError("发布记录暂不可读取，请稍后刷新。");}
    finally{setLoading(false);}
  },[root]);
  useEffect(()=>{
    const initial=setTimeout(()=>{void refresh();},0);
    const interval=setInterval(()=>{void refresh();},15000);
    return()=>{clearTimeout(initial);clearInterval(interval);};
  },[refresh]);
  const activeTest=rows.some(r=>r.environment==="TEST"&&active(r.status));
  const activeProd=rows.some(r=>r.environment==="PRODUCTION"&&active(r.status));
  const tested=rows.filter(r=>r.environment==="TEST"&&r.status==="READY"&&!!r.imageDigest);
  const candidate=tested.find(r=>r.id===selectedTestId)??tested[0];
  async function trigger(environment:"TEST"|"PRODUCTION"){
    if(busy)return;
    if(environment==="PRODUCTION"&&!confirm("确认将测试环境验证的完全相同镜像提交生产发布审批？正式流量变更需要 GitOps PR 人工审核。"))return;
    setBusy(true);setError("");
    try{
      const response=await fetch(root+"/hosted/releases",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(environment==="PRODUCTION"?{environment,testedReleaseId:candidate?.id}:{environment})
      });
      if(!response.ok){
        const value=await response.json() as {error?:string};
        throw new Error(errorDescription(value.error??""));
      }
      await refresh();
      router.refresh();
    }catch(e){setError(e instanceof Error?e.message:"提交发布任务失败。");}
    finally{setBusy(false);}
  }
  return <section className="card hosted-release-panel">
    <div className="section-title"><h3>应用交付</h3><span className="tag">Temporal + GitHub + Argo CD</span></div>
    <p className="muted">平台自动从 GitHub 执行构建，并在有权人员审核 GitOps 变更后部署；生产仅能发布已验证的测试镜像。</p>
    <div className="release-action-grid">
      <div className="release-action">
        <strong>1. 构建并部署测试</strong>
        <p>从 <code>{repo}</code> 的默认分支构建，得到 GHCR 不可变镜像后自动发起部署审核。</p>
        <button type="button" disabled={busy||activeTest} onClick={()=>void trigger("TEST")}>
          {activeTest?"测试发布进行中":"部署到测试"}
        </button>
      </div>
      <div className="release-action">
        <strong>2. 将已验证版本发布生产</strong>
        <p>{candidate?.imageDigest?
          "选择已验证的测试镜像；可以选择历史版本进行安全回退。":
          "测试环境尚未完成可信部署验证。"}</p>
        {tested.length>0&&<label>选择已验证版本
          <select value={candidate?.id??""} onChange={e=>setSelectedTestId(e.target.value)}>
            {tested.map(r=><option key={r.id} value={r.id}>
              {r.imageDigest?.slice(-16)} · {new Date(r.createdAt).toLocaleString("zh-CN")}
            </option>)}
          </select>
        </label>}
        <button type="button" disabled={busy||activeProd||!candidate?.imageDigest||
          candidate.imageDigest===productionDigest}
          onClick={()=>void trigger("PRODUCTION")}>
          {activeProd?"生产发布进行中":"发布到生产"}
        </button>
      </div>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    <div className="section-title"><h4>发布执行记录</h4>
      <button type="button" className="button-secondary" disabled={busy}
        onClick={()=>void refresh()}>刷新状态</button></div>
    {loading&&<p className="muted">读取中…</p>}
    {!loading&&!rows.length&&<p className="muted">暂无发布记录。首次使用需让仓库管理员完成标准 GitHub Actions 构建模板接入。</p>}
    <div className="hosted-release-history">{rows.map(r=><article key={r.id} className="workbench-item">
      <div><strong>{r.environment==="TEST"?"测试环境":"生产环境"} · {labels[r.status]}</strong>
        <p className="muted">{r.note||"等待任务反馈"}</p>
        <p className="muted">{new Date(r.createdAt).toLocaleString("zh-CN")}</p>
        <div className="actions">
          {r.buildRunId&&<a target="_blank" rel="noopener noreferrer"
            href={"https://github.com/"+repo+"/actions/runs/"+r.buildRunId}>构建详情 →</a>}
          {r.gitopsPrNumber&&<a target="_blank" rel="noopener noreferrer"
            href={"https://github.com/NoName4Me/enterprise-app-marketplace/pull/"+r.gitopsPrNumber}>审核发布 PR →</a>}
        </div>
      </div>
      <span className="tag">{r.status}</span>
    </article>)}</div>
    <p className="muted">源码仓库必须安装平台的标准构建工作流
      <a href="https://github.com/NoName4Me/enterprise-app-marketplace/blob/dev/templates/github/marketplace-build.yml"
        target="_blank" rel="noopener noreferrer">（查看接入模板）</a>。
      尚未在 Mac mini 验证的 NodePort 不能宣称从局域网可访问。</p>
  </section>;
}
