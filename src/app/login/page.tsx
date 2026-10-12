"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {authClient} from "@/lib/auth-client";
export default function Login(){
 const router=useRouter();
 const [email,setEmail]=useState("");const [password,setPassword]=useState("");
 const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setError("");setBusy(true);
  try{
   const result=await authClient.signIn.email({email,password});
   if(result.error)setError("登录失败，请检查账号或密码");
   else{router.replace("/apps");router.refresh();}
  }catch{setError("登录服务暂不可用");}
  finally{setBusy(false);}
 }
 return <main><div className="card"><h1>员工登录</h1><p>账号由管理员开通，公开注册关闭。</p>
  <form onSubmit={submit}>
   <label>邮箱<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label>密码<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   {error&&<p className="error" role="alert">{error}</p>}
   <button type="submit" disabled={busy}>{busy?"登录中…":"登录"}</button>
  </form></div></main>;
}
