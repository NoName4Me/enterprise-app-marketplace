# 首轮技术架构设计（阶段 0 交付）

状态：**认证基础实现已在 GitHub CI 验证；应用发布业务尚未实现**；2026-10-13。面向首个垂直闭环（MVP-1），不是全产品架构承诺。

## 1. 架构结论

采用**模块化单体、同源全栈 Web 应用**，不拆微服务、不单独建设 BFF。初版推荐：

| 层 | 选型 | 理由 |
| --- | --- | --- |
| Web + BFF + HTTP API | Next.js App Router + React + TypeScript；Node.js runtime | 一个仓库/进程处理 UI、鉴权与业务 API，减少跨服务协作；保留 Node/Docker 自托管能力 |
| 样式 | Tailwind CSS，按需引入可访问 UI 基础组件 | 快速实现统一样式；组件库不是业务架构 |
| 表单/API 约束 | Zod | 边界输入统一校验；服务端是最终校验源 |
| 数据库 | PostgreSQL | 事务、外键、检查约束、局部唯一索引能直接保障审核流程一致性 |
| 数据访问 | Drizzle ORM + 版本化 SQL 迁移 | TS schema 与显式迁移可审查；不在生产环境使用 schema push |
| 身份认证 | Better Auth（邮件/密码 + Admin 插件 + 服务端会话），禁止自助注册 | 避免自研密码哈希、会话签发、退出等安全关键逻辑 |
| 业务授权 | 自行定义小型权限策略函数，服务端执行 | 业务资源所有权与审批权限属于领域逻辑，不交给 UI 或认证库的通用角色名 |
| 单元/集成测试 | Vitest + 独立 PostgreSQL 测试库 | 验证领域行为和真实事务/约束 |
| 浏览器端到端 | Playwright | 模拟员工、创建者、管理员的真正浏览器工作流 |
| 代码检查 | TypeScript strict + ESLint + 格式化工具 | 支持 AI 代码的最低质量闸门 |

首次提交实现时，用当日兼容的稳定版本锁定 lockfile；以 CI 实际安装、构建与测试验证兼容性。不要无依据照搬旧教程中的导入路径。

**认证实现前要做适配 Spike**：验证 Better Auth 当前版本与 Next.js、Drizzle/PostgreSQL 的适配路径；关闭 public sign-up；创建管理员和员工用户的受控管理 API；密码修改和会话失效。适配不过时先调整库选型，而不是改为手写 Session/JWT。

## 2. 系统边界

```text
Browser
  └─ HTTPS -> Next.js (same origin)
                 ├─ Pages: /login, /apps, /apps/:id, /my/apps, /admin/reviews, /admin/users
                 ├─ Auth: session validation (Better Auth)
                 ├─ API/Server functions: validate input -> authorize -> transaction
                 ├─ Domain: users/permissions, app registration, submissions, reviews, public catalog
                 └─ Drizzle -> PostgreSQL
```

首轮不使用：独立 API 服务、消息队列、Redis、对象存储、向量数据库、全文检索服务、WebSocket。若后续出现真实需求再引入。

### 模块组织建议（逻辑边界，不强迫与目录一一对应）

- `auth`: login/logout、session、用户禁用检查。
- `users`: 管理员开通/停用账号、授予和撤回应用创建权。
- `applications`: 应用实体、内容版本、草稿及提交。
- `reviews`: 审批、驳回、审批审计。
- `catalog`: 仅读取正式已上架版本；搜索/详情不会读取草稿。
- `shared/db`: schema、迁移、事务、共享类型和有限基础设施组件。

业务读写优先通过明确的 service/use-case 函数实现。Server Component/Server Action/Route Handler 只能作为传输层入口，不承载分散的授权规则。

## 3. 首轮页面与入口

| 页面/入口 | 首轮内容 |
| --- | --- |
| `/login` | 账号密码登录和安全错误提示 |
| `/apps` | 上架应用列表、名称关键词搜索 |
| `/apps/[id]` | 已上架应用详细信息及外部访问链接 |
| `/my/apps` | 我创建的应用和当前审核状态 |
| `/my/apps/new`、`/my/apps/[id]/edit` | 创建/编辑草稿、提交申请、查看驳回原因 |
| `/admin/reviews` | 待审列表、详情、通过/驳回 |
| `/admin/users` | 开通/停用员工，赋予/撤销创建权限 |

按完成垂直闭环为目标，不预先建设复杂首页、设计系统或工作台。

### API 约束

- API 是同源认证 API，写操作必须校验 session + 账号状态 + 业务权限 + 资源状态。
- 推荐 REST 风格的最小资源入口：`/api/apps`、`/api/my/apps`、`/api/my/apps/{id}/submissions`、`/api/admin/reviews/{id}/approve|reject`、`/api/admin/users`；具体路由在实现中定稿。
- `/api/apps`、`/api/apps/{id}` 和公开 UI **只依赖 `published_revision_id` 所指内容**；未经批准的版本一律不读出。
- 公开列表和详情对未登录者返回 401/跳转登录；无权或未上架资源向普通员工统一返回 404，避免泄漏元信息。
- 正常业务冲突（重复提交、已被他人审核）返回 409；校验错误返回 400/422；缺权限返回 403，错误结构应稳定。
- 对用户特定内容、审核页面及应用市场动态列表禁用不当的公开缓存，避免缓存将审核内容暴露给其他会话。

## 4. 数据与部署路径

### 本地环境

- Node.js LTS（具体支持版本以锁定的 Next.js/Better Auth 兼容要求为准）。
- `pnpm`（锁定版本），PostgreSQL 开发容器 + 测试容器（Docker Compose）。
- 环境变量模板 `.env.example`，真实 `.env*` 加入 `.gitignore`；`DATABASE_URL`、认证 secret 等不入库。
- 数据 schema 变更通过审查后的 SQL migration；建库、迁移、开发、测试、构建均有可复现命令。

### 发布方案

**首选平台无关的 Node.js/Docker 部署**：应用一个服务实例起步；独立托管的持久化 PostgreSQL；HTTPS 入口；DB 迁移作为受控发布步骤，不在每个实例启动时自动执行。静态资源与图片起初可使用安全的外部 URL 或提供内置占位图；上传系统并非首轮目标。

**Sites 可作为后续候选而非本次确定部署目标**。没有在本阶段验证它是否支持项目所需 Node runtime、外部数据库连接、环境变量、可控迁移和日志。只有完成部署 Spike 后才选择；如不满足，则用兼容 Node/Docker 和 PostgreSQL 的托管平台。Next.js 的 Node.js server / Docker 形态为官方支持路径。

### 发布和回退

- 初次发布：数据库备份 → 执行前向兼容迁移 → 部署版本 → smoke test（登录、公开列表、权限阻断）。
- 应用版本回退：重新部署上一个可用 Git commit / 制品，优先依赖向前兼容迁移；**不能假设代码回退可自动回滚数据库**。
- 高风险不可逆迁移独立审查并先备份；保留恢复测试记录。
- 开发阶段不使用真实企业内部地址、账号、密钥或员工数据。

## 5. 关键质量与安全边界

- 认证由成熟库处理；使用安全的 Cookie/session 设置及登录限速；生产只允许 HTTPS；按 OWASP 指导配置密码存储。
- **登录成功≠具备管理或创建权**。所有领域操作在服务端按用户、资源所有者、权限、版本状态逐一校验；`proxy` 或 UI 重定向不算授权。
- 关闭公开注册；首个管理员由受控脚本在数据库排他锁下执行官方服务端 API，密码交互输入；若存在任何用户则拒绝再次初始化。
- 业务关键变更（赋权、提交、通过、驳回）保留 actor、时间、请求关联 ID 和必要前后状态审计；不记录密码/会话令牌。
- Web 外链校验仅允许 `https:`（本地测试数据可使用专门的受控测试地址），拒绝 `javascript:`、`data:` 等协议；展示为安全普通超链接，不由后端主动抓取任意 URL，避免 SSRF。
- 首轮不允许用户直接上传任意 SVG/HTML；图标采用预置图标或受控 HTTPS URL，并在前端避免未经审查的富文本 HTML 注入。
- 测试必须涵盖未登录、普通员工无创建权、非所有者、越权审批、未发布详情直达、并发审批及公开数据隔离。

## 6. 选择与替代方案

| 替代 | 现在不选原因 | 何时重新考虑 |
| --- | --- | --- |
| Vite SPA + Fastify/NestJS 双工程 | 双服务部署与认证通信成本更高；对当前少量内部用户场景收益不明显 | 有稳定独立 API 消费者、复杂异步服务需求 |
| 微服务 / 事件驱动 | 审核与版本事务必须一致，拆分先增加分布式复杂度 | 高组织规模及独立团队边界出现 |
| SQLite | 本地极简但发布审批需并发一致性，且生产多实例持久化不便利 | 仅纯本地演示、不要求部署 |
| Prisma | 同样可用；相比 Drizzle 并无首版业务收益优势 | ORM 团队偏好/兼容性或调试证据改变 |
| 自研密码会话 | 风险高、价值低，偏离产品目标 | 仅在有无法替代的特殊需求且经安全审查 |
| Elasticsearch/向量库 | 首轮只有简单目录，暂时没有证据证明需要 | 搜索评测表明数据库搜索不足 |
| Sites 直接绑定 | 后端功能及数据库/迁移适配未实测 | 完成部署 Spike 且测试通过 |

## 7. 来源（技术能力参考，不代表本项目已运行验证）

- Next.js 部署说明：https://nextjs.org/docs/app/getting-started/deploying
- Better Auth Next.js：https://better-auth.com/docs/integrations/next
- Better Auth 邮件密码与关闭注册：https://better-auth.com/docs/authentication/email-password
- Better Auth Drizzle Adapter：https://better-auth.com/docs/adapters/drizzle
- Drizzle 迁移：https://orm.drizzle.team/docs/migrations
- OWASP 密码存储：https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Session 管理：https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
