"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { categoryNames, explainError } from "@/lib/marketplace-labels";
type Content={name:string;summary:string;description:string;category:string;targetUrl:string;iconRef:string|null};
type SourceKind="EXTERNAL"|"HOSTED";
const empty:Content={name:"",summary:"",description:"",category:"other",targetUrl:"",iconRef:null};
export function ApplicationForm({mode,appId,initial,sourceKind:fixedKind="EXTERNAL",sourceRepository:fixedRepo=null}:{
 mode:"create"|"edit";appId?:string;initial?:Content;
 sourceKind?:SourceKind;sourceRepository?:string|null;
}){
 const router=useRouter();
 const [form,setForm]=useState<Content>(()=>initial?{
  name:initial.name,summary:initial.summary,description:initial.description,
  category:initial.category,targetUrl:initial.targetUrl,iconRef:initial.iconRef,
 }:{...empty});
 const [sourceKind,setSourceKind]=useState<SourceKind>(fixedKind);
 const [sourceRepository,setSourceRepository]=useState(fixedRepo??"");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 function set<K extends keyof Content>(key:K,value:Content[K]){setForm(s=>({...s,[key]:value}));}
 async function send(url:string,method:string,body?:unknown){
  const r=await fetch(url,{method,headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});
  const data=await r.json();if(!r.ok)throw {code:data.error,status:r.status};
  return data;
 }
 async function run(submit:boolean){
  setBusy(true);setError("");setNotice("");
  let createdId:string|undefined;
  try{
   const target=mode==="create"?"/api/my/apps":"/api/my/apps/"+appId;
   const payload=mode==="create"?{...form,sourceKind,
    sourceRepository:sourceKind==="HOSTED"?sourceRepository.trim():null}:form;
   const result=await send(target,mode==="create"?"POST":"PATCH",payload);
   const id=mode==="create"?result.id as string:appId!;
   if(mode==="create")createdId=id;
   if(submit)await send("/api/my/apps/"+id+"/submit","POST");
   setNotice(submit?"已提交市场审核。":"应用信息已保存。");
   if(mode==="create")router.push("/my/apps/"+id);
   router.refresh();
  }catch(e){
   const err=e as {code?:string;status?:number};
   setError(err.code==="hosted_production_not_deployed"?"托管应用须先完成测试与生产部署后才可申请市场上架。":explainError(err.code,err.status));
   if(createdId)router.push("/my/apps/"+createdId);
  }finally{setBusy(false);}
 }
 function onSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();void run(false);}
 const hosted=sourceKind==="HOSTED";
 return <form onSubmit={onSubmit} className="card form-panel app-create-form">
  {mode==="create"&&<div className="app-source-choice" aria-label="应用来源">
   <button type="button" className={"source-option"+(!hosted?" selected":"")} aria-pressed={!hosted}
    onClick={()=>setSourceKind("EXTERNAL")} disabled={busy}>
    <strong>接入已有应用</strong><span>只需名称、介绍和访问地址，平台不管理部署。</span>
   </button>
   <button type="button" className={"source-option"+(hosted?" selected":"")} aria-pressed={hosted}
    onClick={()=>setSourceKind("HOSTED")} disabled={busy}>
    <strong>从 GitHub 创建</strong><span>连接代码仓库，由平台管理测试和生产环境。</span>
   </button>
  </div>}
  <div className="section-title"><h2>{mode==="create"?"应用基本信息":"编辑应用信息"}</h2>
   <span className="tag">{hosted?"平台托管":"外部应用"}</span></div>
  {hosted&&<div className="form-block">
    <label>GitHub 仓库 <input required={mode==="create"} value={sourceRepository}
      disabled={mode==="edit"} placeholder="owner/repository" maxLength={140}
      onChange={e=>setSourceRepository(e.target.value)}/></label>
    <p className="muted">测试、生产环境和内部资源关联由平台自动创建。登记仓库不代表已构建或部署。后续发布需要 GitHub 构建权限及可用的镜像。</p>
  </div>}
  <label>应用名称<input required value={form.name} onChange={e=>set("name",e.target.value)} maxLength={120} placeholder="例如：订单管理"/></label>
  <label>一句话介绍<input required value={form.summary} onChange={e=>set("summary",e.target.value)} maxLength={300} placeholder="这个应用帮谁解决什么问题？"/></label>
  <div className="two-columns">
   <label>类别<select value={form.category} onChange={e=>set("category",e.target.value)}>
    {Object.entries(categoryNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}
   </select></label>
   {!hosted&&<label>应用访问地址<input type="url" value={form.targetUrl} onChange={e=>set("targetUrl",e.target.value)}
     placeholder="https://app.example.com" required={mode==="create"}/></label>}
  </div>
  <label>详细介绍（可选）<textarea rows={4} maxLength={5000} value={form.description}
    onChange={e=>set("description",e.target.value)}/></label>
  <details className="optional-fields"><summary>外观设置</summary>
   <label>图标 HTTPS 地址<input type="url" value={form.iconRef??""}
     onChange={e=>set("iconRef",e.target.value||null)} placeholder="https://..." /></label>
  </details>
  {hosted&&<p className="notice">平台已预留「测试 → 生产」发布模型。首次真实发布需要先完成镜像构建与部署适配；当前不会生成假的访问地址或报告部署成功。</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  {notice&&<p role="status" className="notice">{notice}</p>}
  <div className="actions">
    <button disabled={busy} type="submit">{busy?"保存中…":"保存应用"}</button>
    {!hosted&&<button type="button" disabled={busy} className="button-secondary" onClick={()=>void run(true)}>
     保存并提交审核
    </button>}
  </div>
 </form>;
}
