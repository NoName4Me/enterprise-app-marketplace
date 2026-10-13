// Measurable scenario-matching baseline. It never invents catalog entries or
// claims to use an LLM; all evidence comes from the approved published revision.
export const scenarios = ["想查看业务报表和数据趋势", "需要管理项目和团队任务", "想预约会议室", "需要整理共享文档", "寻找开发调试工具"];
const groups = [
  ["报表", "数据", "指标", "分析", "趋势", "统计", "看板", "经营", "analytics"],
  ["项目", "任务", "进度", "协作", "团队", "沟通", "collaboration"],
  ["会议", "预约", "会议室", "日程", "office"],
  ["文档", "知识", "资料", "共享", "笔记", "office"],
  ["开发", "调试", "研发", "代码", "接口", "工具箱", "development"],
];
type Candidate = { id: string; name: string; summary: string; description: string; category: string };
export function matchScenarios<T extends Candidate>(query: string, apps: T[]) {
  const input = query.toLowerCase().trim();
  if (!input) return [];
  const terms = new Set<string>();
  for (const group of groups) if (group.some(word => input.includes(word))) group.forEach(word => terms.add(word));
  for (const word of input.split(/[\s,，。；;、!?！？]+/u).filter(x => x.length >= 2)) terms.add(word);
  const mustExclude = new Set<string>();
  for (const group of groups) if (group.some(word => input.includes(`不要${word}`) || input.includes(`不需要${word}`))) group.forEach(word => mustExclude.add(word));
  return apps.map(app => {
    const evidence = `${app.name} ${app.summary} ${app.description}`.toLowerCase();
    const matches = [...terms].filter(term => !mustExclude.has(term) && evidence.includes(term));
    const excluded = [...mustExclude].some(term => evidence.includes(term));
    return { app, score: excluded ? 0 : matches.length, terms: matches.slice(0, 4), reason: `已上架信息包含「${matches.slice(0, 3).join("、")}」，可作为候选工具。` };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
}
