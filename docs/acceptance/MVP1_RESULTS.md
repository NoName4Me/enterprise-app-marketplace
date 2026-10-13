# 阶段 1 · MVP-1 浏览器验收记录

- 时间：2026-10-13
- 范围：独立员工登录 → 创建 Web 应用草稿 → 提交审核 → 管理员驳回/批准 → 员工搜索访问 → 已上架更新复审。
- 状态：**CI/E2E PASSED；生产安全与正式部署 NOT RUN**。
- 运行证据：[GitHub Actions 38359384947](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38359384947)。
- 环境：GitHub Actions Ubuntu、Node 22、PostgreSQL 16、Playwright Chromium、Next.js 生产构建（`pnpm start`）。

## 已实际执行

| 测试 | 方法 | 结果 |
| --- | --- | --- |
| 依赖安装与锁文件一致性 | pnpm install --frozen-lockfile | PASS |
| Drizzle migration 新库初始化与迁移无漂移 | 真正 PostgreSQL | PASS |
| 初始管理员建立与重复建立被拒 | 初始化 CLI + PostgreSQL | PASS |
| T01 认证会话+T02 版本/审核权限和事务回滚 | Vitest + PostgreSQL | PASS（9 tests） |
| 基础单元测试 | Vitest | PASS（2 tests） |
| TypeScript、ESLint、生产构建 | CI | PASS |
| 管理员创建发布者、普通员工及授权 | Playwright Chromium | PASS |
| 普通员工 UI 不可创建与直接 POST 403 | Playwright Chromium + HTTP | PASS |
| 发布者新建、填写内容和提交审批 | Playwright Chromium | PASS |
| 未审批应用直接访问详情 404 | Playwright Chromium | PASS |
| 管理员驳回、发布者查看原因并重提 | Playwright Chromium | PASS |
| 管理员批准后，员工市场搜索和访问链接 | Playwright Chromium | PASS |
| 上架应用更新审核期间旧版本持续公开 | Playwright Chromium | PASS |
| 更新版本批准后切换公开详情和外链 | Playwright Chromium | PASS |
| 退出登录 UI | Playwright Chromium | PASS |

## 质量复盘：真实 E2E 暴露的三类问题

1. 认证可信 Origin 不一致：`127.0.0.1` 与 `localhost` 不是同一 Origin。修正 Playwright 的应用根地址。
2. 初版测试使用单浏览器反复切换账号，存在会话与限流干扰；改为三个独立浏览器上下文，模拟真实同时登录的角色。
3. 已驳回申请再编辑时，服务端版本记录包含 `id/status/sequence` 等只读字段；前端把整条记录原样作为表单对象提交，服务端正确拒绝。现已增加**可编辑字段白名单投影**，E2E 重提与更新已通过。

未运行的独立浏览器用例：移动端布局手动可用性、浏览器跨用户缓存攻击扫描、低速网络/断网恢复、可访问性自动审计、不同浏览器兼容性验证。

## 不属于本次通过范围的事项

- 首登强制改密、最后管理员保护、全量审计/账号找回和生产限速；
- 真实公网或内网部署、备份恢复演练、数据库高可用及灾难恢复；
- 下架、复杂搜索/推荐、评价/社区、AI 应用发现；
- 外部第三方 Web 应用自身的使用权限、稳定性及安全审查。

首个工程闭环的验收通过**不等于整份 PRD 或生产上线验收通过**。
