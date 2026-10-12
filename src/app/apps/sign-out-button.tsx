"use client";
import {useRouter} from "next/navigation";
import {authClient} from "@/lib/auth-client";
export function SignOutButton(){
 const router=useRouter();
 async function logout(){await authClient.signOut();router.replace("/login");router.refresh();}
 return <button type="button" onClick={logout}>退出登录</button>;
}
