"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {authClient} from "@/lib/auth-client";
import {UiIcon} from "@/app/components/ui-icon";
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
 return <main className="login-layout"><section className="login-intro">
  <div className="brand"><span className="brand-mark"><UiIcon name="boxes"/></span>企业应用市场</div>
  <div><p className="eyebrow">TOOLS FOR BETTER WORK</p><h1>好工具，<br/>让工作更简单。</h1><p>一个发现内部应用的地方。<br/>连接工具，专注于真正重要的工作。</p></div>
  <span className="muted">企业内部 · Web 应用发现平台</span>
 </section><section className="login-panel"><div className="card login-card"><p className="eyebrow">欢迎回来</p><h2>员工登录</h2><p className="muted">使用管理员为你开通的账号登录。</p>
  <form onSubmit={submit}>
   <label>邮箱<input type="email" required autoComplete="username" placeholder="你的工作邮箱" value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <label>密码<input type="password" required autoComplete="current-password" placeholder="输入密码" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   {error&&<p className="error" role="alert">{error}</p>}
   <button type="submit" disabled={busy}>{busy?"登录中…":"登录"}</button>
  </form><p className="login-note">账号由管理员开通，公开注册关闭。</p></div></section></main>;
}
