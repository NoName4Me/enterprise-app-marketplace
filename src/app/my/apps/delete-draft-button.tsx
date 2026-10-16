"use client";
import {useRouter} from "next/navigation";
import {useState} from "react";
export function DeleteDraftButton({appId,appName}:{appId:string;appName:string}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function remove(){
    if(busy||!window.confirm("删除尚未提交的应用草稿「"+appName+"」？\n这会同时释放系统预留的测试/生产端口，无法撤销。"))return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/my/apps/"+appId,{method:"DELETE"});
      if(!response.ok){
        const body=await response.json().catch(()=>({})) as {error?:string};
        if(response.status===409)throw new Error("该应用已有审核、需求或部署记录，不允许作为草稿删除。");
        if(response.status===403||response.status===404)throw new Error("无权限删除此应用。");
        throw new Error(body.error??"删除失败，请刷新后重试。");
      }
      router.replace("/my/apps");
      router.refresh();
    }catch(e){setError(e instanceof Error?e.message:"删除失败。");}
    finally{setBusy(false);}
  }
  return <section id="draft-delete" className="card draft-delete-section">
    <h3>删除应用草稿</h3>
    <p className="muted">只允许删除从未提交审核且没有使用记录的草稿。系统会同步释放自动生成的环境和端口预约。</p>
    <button className="danger-button" disabled={busy} onClick={()=>void remove()} type="button">
      {busy?"正在删除…":"删除此草稿"}
    </button>
    {error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
