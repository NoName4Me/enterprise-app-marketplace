import { describe, expect, it } from "vitest";
import { validateApplicationSource, validateContent } from "./app-validation";
describe("application source onboarding",()=>{
 it("defaults legacy payload to external registration",()=>{
  expect(validateApplicationSource({name:"Legacy"})).toEqual({sourceKind:"EXTERNAL",sourceRepository:null});
 });
 it("accepts managed GitHub app without external URL",()=>{
  expect(validateApplicationSource({sourceKind:"HOSTED",sourceRepository:"Example/Customer-App"}))
    .toEqual({sourceKind:"HOSTED",sourceRepository:"example/customer-app"});
  expect(validateContent({name:"示例系统",summary:"业务简介",targetUrl:""}).targetUrl).toBe("");
 });
 it("rejects unsafe or ambiguous repository values",()=>{
  for(const sourceRepository of ["","../secret","x/..","x/y/child","x/.","http://github.com/x/y","x/white space"]){
   expect(()=>validateApplicationSource({sourceKind:"HOSTED",sourceRepository})).toThrow();
  }
 });
 it("rejects attaching a repo to an external link app",()=>{
  expect(()=>validateApplicationSource({sourceKind:"EXTERNAL",sourceRepository:"someone/repo"})).toThrow();
 });
 it("keeps a public external app's HTTPS URL requirement",()=>{
  expect(()=>validateContent({name:"Example",summary:"Summary",targetUrl:""},undefined,true)).toThrow();
  expect(validateContent({name:"Example",summary:"Summary",targetUrl:"https://example.com"},undefined,true).targetUrl)
   .toBe("https://example.com");
 });
});
