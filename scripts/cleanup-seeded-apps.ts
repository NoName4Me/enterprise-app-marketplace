import "dotenv/config";
import {eq, and} from "drizzle-orm";
import {db} from "../src/db/client";
import {applications,appRevisions,user,appAccessRequests,requirements,
  appComponents,appEnvironments,componentEnvironments,externalReferences,
  assetEvents,appHostedPorts} from "../src/db/schema";

// Exact signatures of the retired catalog fixtures. Never match on "演示" alone.
const expected=new Map([
  ["演示 · 项目协作台","https://example.com/projects"],
  ["演示 · 数据看板","https://example.com/analytics"],
  ["演示 · 会议室预约","https://example.com/rooms"],
  ["演示 · 研发工具箱","https://example.com/developer"],
  ["演示 · 文档协作","https://example.com/docs"],
  ["演示 · 报表中心","https://example.com/reports"],
]);
const apply=process.argv.includes("--apply");
if(process.argv.slice(2).some(arg=>arg!=="--apply"))throw new Error("Only --apply is supported.");
if(!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname!=="/market")
  throw new Error("Refusing any database other than market");
const ownerEmail="demo-publisher@example.test";
await db.transaction(async tx=>{
  const rows=await tx.select({
    id:applications.id,kind:applications.sourceKind,ownerId:applications.ownerUserId,
    publishedId:applications.publishedRevisionId,
    revisionId:appRevisions.id,name:appRevisions.name,url:appRevisions.targetUrl,
    description:appRevisions.description,status:appRevisions.status,
    sequence:appRevisions.sequence,
  }).from(applications).innerJoin(user,eq(user.id,applications.ownerUserId))
    .innerJoin(appRevisions,eq(appRevisions.appId,applications.id))
    .where(eq(user.email,ownerEmail));
  const countByApp=new Map<string,number>();
  for(const row of rows)countByApp.set(row.id,(countByApp.get(row.id)??0)+1);
  let cleaned=0;
  for(const row of rows){
    if(countByApp.get(row.id)!==1||row.kind!=="EXTERNAL"||
      row.status!=="APPROVED"||row.sequence!==1||
      row.revisionId!==row.publishedId||expected.get(row.name)!==row.url||
      !row.description.includes("这是用于展示应用市场功能的示例应用"))continue;
    const protectedRows=await Promise.all([
      tx.select({id:appAccessRequests.id}).from(appAccessRequests).where(eq(appAccessRequests.appId,row.id)).limit(1),
      tx.select({id:requirements.id}).from(requirements).where(eq(requirements.appId,row.id)).limit(1),
      tx.select({id:appComponents.id}).from(appComponents).where(eq(appComponents.appId,row.id)).limit(1),
      tx.select({id:appEnvironments.id}).from(appEnvironments).where(eq(appEnvironments.appId,row.id)).limit(1),
      tx.select({id:componentEnvironments.id}).from(componentEnvironments).where(eq(componentEnvironments.appId,row.id)).limit(1),
      tx.select({id:externalReferences.id}).from(externalReferences).where(eq(externalReferences.appId,row.id)).limit(1),
      tx.select({id:assetEvents.id}).from(assetEvents).where(eq(assetEvents.appId,row.id)).limit(1),
      tx.select({id:appHostedPorts.id}).from(appHostedPorts).where(eq(appHostedPorts.appId,row.id)).limit(1),
    ]);
    if(protectedRows.some(result=>result.length)){
      process.stdout.write("PROTECTED, skip: "+row.name+"\n");
      continue;
    }
    process.stdout.write((apply?"REMOVE ":"PREVIEW ")+row.name+" ("+row.id+")\n");
    if(apply)await tx.delete(applications).where(and(
      eq(applications.id,row.id),eq(applications.ownerUserId,row.ownerId),
    ));
    cleaned++;
  }
  if(!apply) {
    process.stdout.write("Preview only; "+cleaned+" matching sample apps, no changes.\n");
    throw new Error("__DRY_RUN_ROLLBACK__");
  }
  process.stdout.write("Removed "+cleaned+" strictly matched sample apps. Fixture user accounts preserved.\n");
}).catch(error=>{
  if(error instanceof Error&&error.message==="__DRY_RUN_ROLLBACK__")return;
  throw error;
});
