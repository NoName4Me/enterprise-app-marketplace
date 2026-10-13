# 企业内部应用市场（Enterprise App Marketplace）

一个面向企业员工的内部应用市场：员工可以发现、使用、评价应用；获得创建权限的员工可以登记并提交应用，管理员审核后上架。产品参考应用商店的发现与互动机制，并支持通过自然语言查找适合的应用。

> 当前状态：**阶段 1 的登录→登记→审核→上架→浏览闭环已完成并通过 GitHub CI 与 Chromium E2E**。本地增量已加入分类、收藏、排序、编辑推荐、上下架管理、评价和应用讨论，并提供场景找应用的关键词基线。真实 AI 模型与生产交付仍未完成。[增量范围和验证限制](docs/engineering/MARKETPLACE_FEATURES.md)。

## 产品范围

- **当前阶段**：只支持将已存在的 Web 应用登记到市场，不负责开发、托管或部署这些应用。
- **应用供给**：创建草稿、提交审核、驳回重提、正式上架、更新重新审核、下架。
- **应用消费**：分类、搜索、详情、访问、收藏、榜单与人工推荐。
- **互动生态**：评分、评价、发布者回复、应用讨论区。
- **AI 应用发现**：通过自然语言描述需求，推荐真实且已上架的应用并解释依据；不提供应用内操作答疑。
- **后续方向**：独立轻论坛、多种应用类型、平台内创建应用、可见范围控制、企业统一身份等。后续方向不构成首版交付承诺。

## 核心业务原则

1. 新应用必须经过管理员审核才能上架。
2. 已上架应用的更新须重新审核，审批期间线上内容和访问地址保持旧版本。
3. 第一版所有已上架应用对已登录员工可见；门户展示权限不等于目标应用使用权限。
4. 独立账号体系，只有获得创建权限的员工才能发布应用申请。
5. AI 只能在当前已上架的真实应用中推荐，不能编造应用或能力。

## 项目资料

- [MVP 产品需求草案](docs/PRD.md)
- [开发阶段与验收计划](docs/ROADMAP.md)
- [已确认的产品决策](docs/decisions/README.md)
- [阶段 0 技术设计索引](docs/design/README.md)
- [首轮业务验收用例](docs/acceptance/MVP1.md)
- [第一轮 Coding Agent 任务包](docs/engineering/AGENT_TASK_01.md)
- [交付、部署与回退方案](docs/engineering/DELIVERY.md)
- [技术选型决策 ADR-001](docs/decisions/ADR-001-technical-baseline.md)

## 协作方式

本项目同时用于实践 AI Native 从零到一开发：产品设计、关键决策和技术评审由对话主线完成；代码、文档、Issue 和 PR 以本仓库为事实来源。实现工作采用小批量、可验证的增量提交。阶段 0 已给出 Next.js + PostgreSQL + Better Auth + Drizzle 的首轮试行技术基线（详见 ADR-001），实际实现、测试及部署仍待后续阶段验证。

## 当前不做的事

当前已提出首轮框架与数据库方案，但未确定生产云平台或 AI 编排框架；不因远期需求预先构建复杂架构。

## 许可

尚未选择开源许可证。仓库公开可读不等同于授予第三方复用、修改或分发代码的许可证。

## 本地快速启动（T01）

需要 Node.js 22、pnpm 10.17.1、Docker / Docker Compose。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# 修改 .env 中的 BETTER_AUTH_SECRET 为本地随机生成的高强度密钥
docker compose up -d
pnpm db:migrate
node scripts/bootstrap-admin.mjs --email admin@example.com --name Administrator
pnpm dev
```

浏览器打开 `http://localhost:3000/login`，登录后进入 `/apps`；管理员可在 `/admin/users` 开通员工、停用员工及维护应用创建权限。T03/T04 已提供真实的应用登记、管理员审核及员工应用市场页面；所有操作均通过 T02 的权限与事务 API。

**注意**：管理员初始化只可在空用户表上执行，不要使用生产密码命令行参数；首次执行时按 CLI 的交互提示输入密码。密码与 `DATABASE_URL` 等机密不能提交 GitHub。若使用其他邮箱，请替换命令中的示例地址。

自动化数据库集成测试会操作用户表，必须使用独立的测试数据库，不能直接对已有真实数据的开发/生产数据库执行；CI 使用独立 PostgreSQL fixture。正式上线前还需首登改密、账号恢复、最后管理员保护和浏览器 E2E 安全验收。

详细信息：[认证与管理员初始化](docs/engineering/T01_AUTH_SETUP.md)、[T01 验证记录](docs/engineering/T01_STATUS.md)。

## 服务端应用发布 API（T02）

- 创建、编辑、提交与管理自己的草稿：`/api/my/apps`、`/api/my/apps/{id}`、`/api/my/apps/{id}/submit`、`/api/my/apps/{id}/draft`。
- 管理员审核：`/api/admin/reviews`、`/api/admin/reviews/{revisionId}/approve` 或 `/reject`。
- 员工公开查询：`/api/apps?q=`、`/api/apps/{id}`（只读取已批准且上架的版本）。

详细请求、权限、返回值和验收结果见 [T02 实施记录](docs/engineering/T02_STATUS.md)、[T02 验收清单](docs/acceptance/T02_RESULTS.md)。未经认证无法使用这些接口。

## 首个完整业务闭环（阶段 1）

管理员在 `/admin/users` 开通员工并授予应用创建权限；发布者通过 `/my/apps` 创建草稿、提交审核并查看结果；管理员在 `/admin/reviews` 审批申请；员工可在 `/apps` 搜索、进入已上架应用详情并通过 HTTPS 外链访问。

已上架应用修改信息时，必须建立新草稿并重新审核；审核期间员工始终看到之前批准的版本。

### 验收与开发检查

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

数据库测试和 Chromium E2E **只能使用隔离测试数据库**。参考 [.github/workflows/t01-compatibility.yml](.github/workflows/t01-compatibility.yml) 中的 PostgreSQL fixture、管理员初始化和端到端执行顺序，不要直接对开发或生产数据库运行含写入/清理的集成测试。

本地 Chromium 测试需要先安装浏览器（`pnpm exec playwright install chromium`），并准备与 CI 等效的独立测试账号/环境；随后运行 `pnpm test:e2e`。浏览器测试以 `http://localhost:3000` 为源，必须和 `BETTER_AUTH_URL` 保持一致。

- [阶段 1 浏览器验收记录](docs/acceptance/MVP1_RESULTS.md)
- [业务领域 API 验收记录](docs/acceptance/T02_RESULTS.md)
- [上线前安全待办](https://github.com/NoName4Me/enterprise-app-marketplace/issues/5)

**限制**：当前不是生产可用版本。首次登录强制修改初始密码、最后管理员的后端保护、完整敏感操作审计及目标托管环境验证尚未完成。

## 容器交付（T05）

通过 Docker 多阶段构建得到非 root Node.js standalone 镜像。真实 CI 已执行镜像构建、连接 PostgreSQL 的容器启动、健康检查和匿名接口 401 验证。操作步骤、数据库迁移及回退要求见 [T05 容器交付记录](docs/engineering/T05_CONTAINER.md)。此检查不代表已部署到生产环境。

账号安全：新账号首登改密、管理员限时一次性密码重置、敏感操作审计和数据库限速已实现；入口 `/account/security`、`/admin/users`，验证与生产配置边界见 [账号安全交付](docs/engineering/ACCOUNT_SECURITY.md)。
