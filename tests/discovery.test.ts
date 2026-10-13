import { describe, expect, it } from "vitest";
import { matchScenarios } from "../src/domain/discovery";
const apps = [
  { id: "reports", name: "报表中心", summary: "统计业务数据趋势", description: "", category: "analytics" },
  { id: "rooms", name: "会议室预约", summary: "安排团队会议", description: "", category: "office" },
];
describe("scenario matching baseline", () => {
  it("matches explicit needs with evidence from catalog text", () => {
    const found = matchScenarios("想分析业务指标", apps);
    expect(found[0].app.id).toBe("reports");
    expect(found[0].terms.every(word => `${found[0].app.name} ${found[0].app.summary}`.includes(word))).toBe(true);
  });
  it("returns no invented candidates for unsupported needs", () => {
    expect(matchScenarios("订购午餐", apps)).toEqual([]);
    expect(matchScenarios("", apps)).toEqual([]);
  });
  it("honors explicitly excluded scenarios", () => {
    expect(matchScenarios("不要报表", apps)).toEqual([]);
  });
});
