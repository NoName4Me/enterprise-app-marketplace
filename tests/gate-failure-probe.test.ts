import { expect, test } from "vitest";

test("门禁验收临时负例，禁止合并", () => {
  expect("关键业务检查必须阻止合并").toBe("预期故意失败");
});
