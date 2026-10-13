import { describe, it, expect } from "vitest";
import { mayCreateApp, mayReviewApp, mayUseMarketplace } from "../src/lib/access";

const employee = { banned: false, role: "user", canCreateApp: false };
describe("live permission predicates", () => {
  it("rejects missing or banned users", () => {
    expect(mayUseMarketplace(null)).toBe(false);
    expect(mayUseMarketplace({ ...employee, banned: true })).toBe(false);
    expect(mayReviewApp({ ...employee, banned: true, role: "admin" })).toBe(false);
  });
  it("distinguishes application creator from platform admin", () => {
    expect(mayCreateApp({ ...employee, canCreateApp: true })).toBe(true);
    expect(mayReviewApp({ ...employee, canCreateApp: true })).toBe(false);
    expect(mayReviewApp({ ...employee, role: "admin" })).toBe(true);
    expect(mayCreateApp({ ...employee, role: "admin" })).toBe(false);
  });
});
