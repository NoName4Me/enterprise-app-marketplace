import {describe,it,expect} from "vitest";
import {eq} from "drizzle-orm";
import {auth} from "../src/lib/auth";
import {db} from "../src/db/client";
import {user} from "../src/db/schema";

describe("Better Auth API boundaries",()=>{
 it("must reject public email/password registration without storing a user",async()=>{
  const email="blocked-registration@example.test";
  const request=new Request("http://localhost:3000/api/auth/sign-up/email",{
   method:"POST",
   headers:{"content-type":"application/json","origin":"http://localhost:3000"},
   body:JSON.stringify({name:"Unauthorized",email,password:"Never-use-this-password-123"})
  });
  const response=await auth.handler(request);
  expect(response.status).toBeGreaterThanOrEqual(400);
  const rows=await db.select({id:user.id}).from(user).where(eq(user.email,email));
  expect(rows).toHaveLength(0);
 });
});
