import {eq} from "drizzle-orm";
import {auth} from "./auth";
import {db} from "@/db/client";
import {user} from "@/db/schema";
export async function getActiveUser(requestHeaders:Headers){
 const current=await auth.api.getSession({headers:requestHeaders});
 if(!current) return null;
 const [record]=await db.select({disabled:user.disabled}).from(user).where(eq(user.id,current.user.id)).limit(1);
 return record&&!record.disabled?current.user:null;
}
