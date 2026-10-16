"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
type Props = { requirementId: string; canManage: boolean; initial: {
  status: "OPEN"|"IN_PROGRESS"|"DONE"|"REJECTED";
  githubPrUrl: string|null; resolution: string|null;
}};
export function RequirementActions({requirementId,canManage,initial}:Props) {
  const router=useRouter();
  const [comment,setComment]=useState(""),[status,setStatus]=useState(initial.status);
  const [pr,setPr]=useState(initial.githubPrUrl??"");
  const [resolution,setResolution]=useState(initial.resolution??"");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  async function save(path:string, body:Record<string,unknown>, method:"POST"|"PATCH") {
    setBusy(true);setError("");setMessage("");
    try {
      const response=await fetch("/api/requirements/"+requirementId+path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      if(!response.ok) throw new Error("操作失败：检查权限、字段格式或状态。");
      setMessage("已保存。");router.refresh();return true;
    } catch(e){setError(e instanceof Error?e.message:"操作失败");return false;}
    finally{setBusy(false)}
  }
  async function postComment(e:FormEvent){e.preventDefault();if(await save("/comments",{body:comment},"POST"))setComment("");}
  async function update(e:FormEvent){e.preventDefault();await save("",{status,githubPrUrl:pr,resolution},"PATCH");}
  return <div className="stack">
    <section className="card"><h3>讨论</h3><form onSubmit={e=>void postComment(e)} className="stack">
      <label>留言<textarea required minLength={1} maxLength={2000} value={comment} onChange={e=>setComment(e.target.value)} /></label>
      <button disabled={busy || !comment.trim()}>发表评论</button>
    </form></section>
    {canManage && <section className="card"><h3>维护者处理</h3><p className="muted">需求在门户内部处理；可关联代码 PR 用于追溯。人工登记的交付链接不代表 CI/部署已验证。</p>
      <form className="stack" onSubmit={e=>void update(e)}>
        <label>状态<select value={status} onChange={e=>setStatus(e.target.value as Props["initial"]["status"])}>
          <option value="OPEN">待处理</option><option value="IN_PROGRESS">处理中</option>
          <option value="DONE">已完成</option><option value="REJECTED">不采纳</option>
        </select></label>
        <label>GitHub PR URL<input type="url" value={pr} onChange={e=>setPr(e.target.value)} placeholder="https://github.com/org/repo/pull/1" /></label>
        <label>处理结论<textarea maxLength={2000} value={resolution} onChange={e=>setResolution(e.target.value)} /></label>
        <button disabled={busy}>更新进度</button>
      </form>
    </section>}
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status" className="notice">{message}</p>}
  </div>;
}
