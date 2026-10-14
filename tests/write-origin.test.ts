import { afterEach, expect, it, vi } from "vitest";
import { assertWriteOrigin } from "../src/domain/write-origin";
afterEach(() => vi.unstubAllEnvs());
it("accepts only the configured public origin despite container internal URL and forged Host", () => {
  vi.stubEnv("BETTER_AUTH_URL", "https://portal.example.test");
  expect(() => assertWriteOrigin(new Request("http://0.0.0.0:3000/api/my/apps", { headers: { origin: "https://portal.example.test", host: "spoofed.test", "x-forwarded-host": "spoofed.test" } }))).not.toThrow();
  for (const origin of ["", "http://0.0.0.0:3000", "http://portal.example.test", "https://portal.example.test:444", "https://attacker.test", "null"]) expect(() => assertWriteOrigin(new Request("https://portal.example.test/api", { headers: { origin } }))).toThrow();
  expect(() => assertWriteOrigin(new Request("https://portal.example.test/api"))).toThrow();
  vi.stubEnv("BETTER_AUTH_URL", "");
  expect(() => assertWriteOrigin(new Request("https://portal.example.test/api", { headers: { origin: "https://portal.example.test" } }))).toThrow();
});
