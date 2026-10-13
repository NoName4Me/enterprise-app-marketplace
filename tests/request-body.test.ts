import { expect, it } from "vitest";
import { readObjectJson } from "../src/domain/app-errors";
it("rejects oversized streamed JSON without requiring Content-Length", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16385)); controller.close(); } });
  const request = new Request("http://localhost:3000", { method: "POST", body, duplex: "half" } as RequestInit);
  await expect(readObjectJson(request)).rejects.toMatchObject({ code: "payload_too_large" });
});
it("parses UTF-8 content and only permits an empty body when explicitly allowed", async () => {
  const request = new Request("http://localhost:3000", { method: "POST", body: JSON.stringify({ name: "测试账号" }) });
  expect(await readObjectJson(request)).toEqual({ name: "测试账号" });
  await expect(readObjectJson(new Request("http://localhost:3000"))).rejects.toMatchObject({ code: "invalid_json" });
  expect(await readObjectJson(new Request("http://localhost:3000"), true)).toEqual({});
});
