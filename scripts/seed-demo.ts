import "dotenv/config";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { auth } from "../src/lib/auth";
import { db } from "../src/db/client";
import { user, appFeedback, appFavorites } from "../src/db/schema";
import { createApplication, submitDraft, reviewRevision, listPublished, listOwnedApplications, getPublished } from "../src/domain/app-service";
import { setFavorite, saveFeedback, addDiscussion, manageListing } from "../src/domain/community-service";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || process.env.NODE_ENV === "production") throw new Error("Demo seed is restricted to a local development database.");
  const accounts = await db.select({ id: user.id, role: user.role, banned: user.banned }).from(user);
  const reviewer = accounts.find(x => !x.banned && (x.role ?? "").split(",").includes("admin"));
  if (!reviewer) throw new Error("Initialize an administrator before loading demo applications.");
  async function demoAccount(email: string, name: string, creator = false) {
    const [existing] = await db.select().from(user).where(eq(user.email, email));
    if (existing) {
      if (existing.name !== name || existing.banned || Boolean(existing.canCreateApp) !== creator) throw new Error("Demo account conflicts with an existing account; refusing to overwrite it.");
      return { id: existing.id };
    }
    // Better Auth's documented trusted server API creates passwordless fixtures.
    // These users have no login credentials and cannot be used to sign in.
    const result = await auth.api.createUser({ body: { email, name, role: "user", data: { canCreateApp: creator } } });
    return { id: result.user.id };
  }
  const publisher = await demoAccount("demo-publisher@example.test", "演示应用负责人", true);
  const reader = await demoAccount("demo-reader@example.test", "演示员工");
  const samples = [
    { name: "演示 · 项目协作台", summary: "集中管理项目、团队任务和进度，让协作更有条理。", category: "collaboration", slug: "projects" },
    { name: "演示 · 数据看板", summary: "查看业务指标和数据趋势，快速掌握经营情况。", category: "analytics", slug: "analytics" },
    { name: "演示 · 会议室预约", summary: "查询会议室空闲时间，安排会议和团队日程。", category: "office", slug: "rooms" },
    { name: "演示 · 研发工具箱", summary: "汇集开发、接口调试和代码工具，减少重复操作。", category: "development", slug: "developer" },
    { name: "演示 · 文档协作", summary: "共享文档、笔记和项目资料，整理团队知识。", category: "collaboration", slug: "docs" },
    { name: "演示 · 报表中心", summary: "查询业务报表、统计指标，分析经营数据。", category: "analytics", slug: "reports" },
  ];
  const owned = await listOwnedApplications(publisher);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const existing = owned.find(x => x.latestName === sample.name);
    if (existing) { process.stdout.write(`Already present: ${sample.name}\n`); continue; }
    const app = await createApplication(publisher, { name: sample.name, summary: sample.summary, category: sample.category,
      description: `这是用于展示应用市场功能的示例应用，不提供真实企业服务。\n\n${sample.summary}\n\n你可以体验收藏、评分、评价与应用讨论。访问地址为公开示例地址，仅用于演示外链入口。`,
      targetUrl: `https://example.com/${sample.slug}`,
    });
    await submitDraft(publisher, app.id);
    assert(!(await listPublished(reader)).some(x => x.id === app.id), "Pending demo must not be publicly visible");
    await reviewRevision({ id: reviewer.id }, app.revisionId, "APPROVED");
    await getPublished(reader, app.id);
    await setFavorite(reader, app.id, true);
    await setFavorite(reader, app.id, true);
    assert.equal((await db.select().from(appFavorites).where(eq(appFavorites.appId, app.id))).length, 1);
    await saveFeedback(reader, app.id, { rating: 4, body: "演示评价：界面清晰，适合日常工作场景。" });
    await saveFeedback(reader, app.id, { rating: i % 2 ? 5 : 4, body: "演示评价：集中找到工具很方便，期待更多应用。" });
    assert.equal((await db.select().from(appFeedback).where(eq(appFeedback.appId, app.id))).length, 1);
    const thread = await addDiscussion(reader, app.id, { body: "演示讨论：这个应用适合哪些工作场景？" });
    await addDiscussion(publisher, app.id, { parentId: thread.id, body: `演示回复：可以用于${sample.summary.replace(/。$/, "")}。这是示例内容。` });
    if (i < 3) await manageListing({ id: reviewer.id }, app.id, { action: "feature", featured: true });
    if (i === 0) {
      await manageListing({ id: reviewer.id }, app.id, { action: "unlist", reason: "演示流程检查：验证公开隔离" });
      assert(!(await listPublished(reader)).some(x => x.id === app.id));
      await assert.rejects(() => getPublished(reader, app.id));
      await manageListing({ id: reviewer.id }, app.id, { action: "relist", reason: "演示流程检查结束，恢复已批准版本" });
      await manageListing({ id: reviewer.id }, app.id, { action: "feature", featured: true });
    }
    process.stdout.write(`Published and checked: ${sample.name}\n`);
  }
  process.stdout.write("Demo applications loaded; publish, favorites, rating updates and listing isolation verified.\n");
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : "Demo seed failed"); process.exit(1); });
