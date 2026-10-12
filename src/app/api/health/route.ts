import {sql} from "drizzle-orm";
import {NextResponse} from "next/server";
import {db} from "@/db/client";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){
 try{
  await db.execute(sql.raw("SELECT 1"));
  return NextResponse.json({status:"ok"},{headers:{"Cache-Control":"no-store"}});
 }catch{
  return NextResponse.json({status:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
 }
}
