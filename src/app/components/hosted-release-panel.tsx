"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {HostedReleaseExecution} from "./hosted-release-execution";

type Release={
  id:string;environment:"TEST"|"PRODUCTION";
  status:"REQUESTING"|"BUILDING"|"WAITING_PR"|"DEPLOYING"|"READY"|"FAILED"|"NEEDS_RECONCILIATION";
  sourceRef:string|null;versionLabel:string|null;releaseNotes:string|null;
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
  const [sourceRef,setSourceRef]=useState("");
  const [versionLabel,setVersionLabel]=useState("");
  const [releaseNotes,setReleaseNotes]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const ledgerVersion=useRef<string|null>(null);
  const refresh=useCallback(async()=>{
    try{
      const response=await fetch(root+"/hosted/releases",{cache:"no-store"});
      if(!response.ok)throw new Error("无法读取发布记录");
      const value=await response.json() as {releases:Release[]};
      const version=value.releases.map(r=>r.id+":"+r.status).join(",");
      const changed=ledgerVersion.current!==null&&ledgerVersion.current!==version;
      ledgerVersion.current=version;
      setRows(value.releases);
      setError("");
      if(changed)router.refresh();
    }catch{setError("发布记录暂不可读取，请稍后刷新。");}
    finally{setLoading(false);}
  },[root,router]);
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
    if(environment==="TEST"&&(!versionLabel.trim()||!releaseNotes.trim())){
      setError("测试发布必须填写版本号和发布说明。");return;
    }
    if(environment==="PRODUCTION"&&!confirm("确认将测试环境验证的完全相同镜像提交生产发布审批？正式流量变更需要 GitOps PR 人工审核。"))return;
    setBusy(true);setError("");
    try{
      const response=await fetch(root+"/hosted/releases",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(environment==="PRODUCTION"?{environment,testedReleaseId:candidate?.id}:{environment,sourceRef:sourceRef.trim(),versionLabel:versionLabel.trim(),releaseNotes:releaseNotes.trim()})
      });
      if(!response.ok){
        const value=await response.json() as {error?:string};
        throw new Error(errorDescription(value.error??""));
      }
      if(environment==="TEST"){setVersionLabel("");setReleaseNotes("");}
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
        <p>从 <code>{repo}</code> 的任意分支或 Commit 构建。首次留空则使用仓库默认分支。</p>
        <label>分支或 Commit
          <input type="text" maxLength={160} value={sourceRef} onChange={e=>setSourceRef(e.target.value)}
            placeholder="例如 dev、feature/search 或完整 Commit SHA（留空＝默认分支）"/>
        </label>
        <label>版本号
          <input type="text" required maxLength={80} value={versionLabel} onChange={e=>setVersionLabel(e.target.value)}
            placeholder="例如 v0.2.0-beta.1"/>
        </label>
        <label>发布说明
          <textarea required maxLength={2000} rows={3} value={releaseNotes} onChange={e=>setReleaseNotes(e.target.value)}
            placeholder="本次修改了什么、修复了什么"/>
        </label>
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
              {r.versionLabel??"早期版本"} · {r.releaseNotes?.slice(0,52)??"无说明"} · {new Date(r.createdAt).toLocaleString("zh-CN")}
            </option>)}
          </select>
        </label>}
        {candidate&&<p className="muted">当前选择：<strong>{candidate.versionLabel??"早期版本"}</strong><br/>{candidate.releaseNotes??"历史发布未填写说明"}</p>}
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
      <div><strong>{r.versionLabel??"早期版本"} · {r.environment==="TEST"?"测试环境":"生产环境"} · {labels[r.status]}</strong>
        {r.releaseNotes&&<p className="pre-wrap">{r.releaseNotes}</p>}
        <p className="muted">源码：{r.sourceRef??"未记录"} · {r.sourceSha?.slice(0,12)??"未确认 SHA"}</p>
        <p className="muted">{r.note||"等待任务反馈"}</p>
        <p className="muted">{new Date(r.createdAt).toLocaleString("zh-CN")}</p>
        <div className="actions">
          {r.buildRunId&&<a target="_blank" rel="noopener noreferrer"
            href={"https://github.com/"+repo+"/actions/runs/"+r.buildRunId}>构建详情 →</a>}
          {r.gitopsPrNumber&&<a target="_blank" rel="noopener noreferrer"
            href={"https://github.com/NoName4Me/enterprise-app-marketplace/pull/"+r.gitopsPrNumber}>审核发布 PR →</a>}
        </div>
        <HostedReleaseExecution root={root} release={r}/>
      </div>
      <span className="tag">{r.status}</span>
    </article>)}</div>
    <p className="muted">源码仓库必须安装平台的标准构建工作流
      <a href="https://github.com/NoName4Me/enterprise-app-marketplace/blob/dev/templates/github/marketplace-build.yml"
        target="_blank" rel="noopener noreferrer">（查看接入模板）</a>。
      尚未在 Mac mini 验证的 NodePort 不能宣称从局域网可访问。</p>
  </section>;
}
