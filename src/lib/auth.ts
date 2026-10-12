import {betterAuth} from "better-auth";
import {drizzleAdapter} from "@better-auth/drizzle-adapter";
import {db} from "@/db/client";
import * as schema from "@/db/schema";
const secret=process.env.BETTER_AUTH_SECRET;
if(!secret || secret.length<32) throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
export const auth=betterAuth({
 secret,database:drizzleAdapter(db,{provider:"pg",schema}),
 emailAndPassword:{enabled:true,disableSignUp:true,minPasswordLength:12},
 user:{additionalFields:{
  disabled:{type:"boolean",defaultValue:false,input:false},
  isAdmin:{type:"boolean",defaultValue:false,input:false},
  canCreateApp:{type:"boolean",defaultValue:false,input:false}
 }}
});
