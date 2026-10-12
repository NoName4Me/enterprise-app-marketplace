import {describe,it,expect} from "vitest";
import {mayCreateApp,mayReviewApp,mayUseMarketplace} from "../src/lib/access";
const employee={disabled:false,isAdmin:false,canCreateApp:false};
describe("account permissions",()=>{
 it("denies missing or disabled users",()=>{
  expect(mayUseMarketplace(null)).toBe(false);
  expect(mayUseMarketplace({...employee,disabled:true})).toBe(false);
  expect(mayReviewApp({...employee,disabled:true,isAdmin:true})).toBe(false);
 });
 it("separates creation from admin review",()=>{
  expect(mayCreateApp({...employee,canCreateApp:true})).toBe(true);
  expect(mayReviewApp({...employee,canCreateApp:true})).toBe(false);
  expect(mayReviewApp({...employee,isAdmin:true})).toBe(true);
 });
});
