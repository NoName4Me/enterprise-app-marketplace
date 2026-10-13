import {headers} from "next/headers";
import {redirect} from "next/navigation";
import {getActiveUser} from "@/lib/active-user";
import {SignOutButton} from "./sign-out-button";
export const dynamic="force-dynamic";
export default async function Apps(){
 const current=await getActiveUser(await headers());
 if(!current)redirect("/login");
 return <main><div className="card"><h1>应用市场</h1><p>已登录：{current.name}</p><p>应用功能将在后续任务实现。</p><SignOutButton/></div></main>;
}
