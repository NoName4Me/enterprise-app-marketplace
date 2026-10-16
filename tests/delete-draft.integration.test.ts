import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {eq} from "drizzle-orm";
import {randomUUID} from "node:crypto";
import {db} from "../src/db/client";
import {user,applications,appComponents,appEnvironments,appHostedPorts,appRevisions} from "../src/db/schema";
import {createApplication,deleteNewDraft,submitDraft} from "../src/domain/app-service";
const alice="delete-draft-"+randomUUID(), bob="delete-draft-"+randomUUID();
const base={name:"未提交的应用草稿",summary:"用于验证草稿可安全撤销",category:"office",
  description:"这是临时的草稿记录，用于隔离数据库验证。",targetUrl:"https://example.test/app"};
const leftover:string[]=[];
beforeAll(async()=>{
  await db.insert(user).values([
    {id:alice,email:alice+"@example.test",name:"Fixture owner",canCreateApp:true,mustChangePassword:false},
    {id:bob,email:bob+"@example.test",name:"Fixture other",canCreateApp:true,mustChangePassword:false},
  ]);
});
afterAll(async()=>{
  // Protected apps remain until the end of the isolated test database.
  for(const id of leftover){
    await db.delete(applications).where(eq(applications.id,id));
  }
  await db.delete(user).where(eq(user.id,alice));
  await db.delete(user).where(eq(user.id,bob));
});
describe.sequential("delete an untouched initial draft",()=>{
  it("disallows non-owner and unauthenticated delete, deletes only owner draft",async()=>{
    const app=await createApplication({id:alice},base);
    const wrong=deleteNewDraft({id:bob},app.id);
    await expect(wrong).rejects.toMatchObject({status:404});
    await expect(deleteNewDraft(null,app.id)).rejects.toMatchObject({status:401});
    expect((await deleteNewDraft({id:alice},app.id)).deleted).toBe(true);
    expect(await db.select().from(applications).where(eq(applications.id,app.id))).toHaveLength(0);
  });
  it("releases exactly the generated hosted draft assets/ports",async()=>{
    const app=await createApplication({id:alice},{
      ...base,targetUrl:"",sourceKind:"HOSTED",sourceRepository:"example/inventory-web",
    });
    expect(await db.select().from(appComponents).where(eq(appComponents.appId,app.id))).toHaveLength(1);
    expect(await db.select().from(appEnvironments).where(eq(appEnvironments.appId,app.id))).toHaveLength(2);
    const endpoints=await db.select().from(appHostedPorts).where(eq(appHostedPorts.appId,app.id));
    expect(endpoints).toHaveLength(2);
    expect(endpoints.every(item=>item.state==="RESERVED")).toBe(true);
    const result=await deleteNewDraft({id:alice},app.id);
    expect(result.deleted).toBe(true);
    expect(await db.select().from(appHostedPorts).where(eq(appHostedPorts.appId,app.id))).toHaveLength(0);
    expect(await db.select().from(applications).where(eq(applications.id,app.id))).toHaveLength(0);
  });
  it("refuses to delete a submitted draft even before approval",async()=>{
    const app=await createApplication({id:alice},base);
    leftover.push(app.id);
    await submitDraft({id:alice},app.id);
    await expect(deleteNewDraft({id:alice},app.id)).rejects.toMatchObject({status:409});
    const revisions=await db.select().from(appRevisions).where(eq(appRevisions.appId,app.id));
    expect(revisions).toHaveLength(1);
    expect(revisions[0].status).toBe("PENDING");
  });
});
