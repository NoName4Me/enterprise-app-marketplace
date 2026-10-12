# ADR-001：MVP-1 技术基线与演进策略

- 状态：**Accepted for MVP-1 implementation**（认证基础兼容性已由 CI 验证；后续业务尚待实现）
- 日期：2026-10-13
- 决策范围：首个纵向闭环，不等于未来产品永久技术承诺
- 业务前提：参考 [已确认产品决策](README.md)

## 背景

首个工程闭环包含独立账号、创建权、内容草稿、审批、正式版本上架与员工浏览。需快速交付，又必须防止未审批内容泄漏、越权、并发审核冲突和审核期间已发布内容被覆盖。后续增量包括版本更新、评价社区及 AI 应用发现。

## 决定

1. **模块化单体、同源全栈**：Next.js App Router + React + TypeScript，使用 Node runtime 处理服务端页面与 API；仅在形成真实系统边界后才拆服务。
2. **数据库**：PostgreSQL。使用 Drizzle ORM 和受控迁移，利用关系约束、事务、局部唯一索引保护审批不变量。
3. **身份认证**：Better Auth 邮箱密码登录、官方 Admin 插件和服务端 Session；禁用自助注册。采用数据库排他锁封装官方 CLI 引导首个管理员，后续员工由插件管理；`canCreateApp` 是独立的业务权限，不由管理员角色隐式授予。账号封禁、恢复和旧会话失效已由 DB 集成测试验证，首登改密及最后管理员保护仍为生产上线阻断项。
4. **应用审批领域模型**：逻辑 App + immutable review snapshots + approved published pointer。UI/API 公开查询只走已发布指针。新应用先搭结构，后续更新复审沿用结构。
5. **质量工具**：TypeScript strict、ESLint、Vitest（单元 + PostgreSQL 集成）、Playwright E2E。CI 规则以实际可执行证据为准。
6. **部署**：Node.js/Docker 与外部 PostgreSQL 作为可移植目标；Sites 仅待后续适配 Spike，并非已经可用的后端托管方案。
7. **任务流程**：小 PR、任务包验收、独立测试，工程代理只按当前范围写代码并提交证据。

## 主要权衡

| 候选 | 评价 |
| --- | --- |
| Next.js 一体化 | UI/BFF/auth 同源，首轮接线较少；需要严格隔离服务端授权与浏览器缓存 |
| SPA + Fastify/NestJS | 服务清晰但跨源认证、部署、联调成本增加，当前没有独立 API 消费者 |
| PostgreSQL | 部署成本略高于 SQLite，但审批与并发事务更自然；方便未来共享部署 |
| SQLite | 本地可行，独立数据库服务更省，但本项目更重视可信并发与多实例演进 |
| Better Auth | 降低自研认证风险；仍需验证插件 API、管理员管理及安全流程，不能“引入库就视为安全” |
| Drizzle | 轻量、迁移可审查；不认为它普遍优于 Prisma |
| Sites | 可候选，但需验证 Node 功能、密钥、外部 DB 与迁移生命周期，不能只凭静态预览判断 |

## 可逆性与风险

- 如果 T01 的兼容性 Spike 失败，可替换认证适配库、ORM 或应用框架，但必须记录修改原因并更新架构、运行手册及验收用例；不得牺牲安全约束。
- 如果云平台不支持容器，可在保留外部 DB 和服务端 Session 的前提下调整部署形态，不转换为仅本地存储的静态应用。
- 最大实现风险在于权限漏检、已发布与待审数据混用、审批并发冲突，而不是 UI 框架性能。
- 新依赖锁版本前重新核对当前官方文档和兼容矩阵（特别是 Better Auth + Next.js + Drizzle 组合）。

## 最小实现验证要求

详见：
- [架构设计](../design/ARCHITECTURE.md)
- [权限矩阵](../design/PERMISSIONS.md)
- [状态与领域模型](../design/PUBLISHING_MODEL.md)
- [验收用例](../acceptance/MVP1.md)
- [AI Coding 任务包](../engineering/AGENT_TASK_01.md)

## 参考官方文档

- https://nextjs.org/docs/app/getting-started/deploying
- https://better-auth.com/docs/integrations/next
- https://better-auth.com/docs/adapters/drizzle
- https://orm.drizzle.team/docs/indexes-constraints

该方案的安装、迁移、类型检查、代码检查、单元及认证数据库集成测试已由 GitHub Actions 验证。其他安全与业务能力仍需独立评估，不等于生产可用。

## 2026-10-13 认证实现复盘

早期设想使用自定义 `isAdmin` / `disabled` 字段，实际改为 Better Auth Admin 插件的 `role` / `banned`；原因是使用经过版本化验证的账号创建、禁用/恢复和 Session 撤销机制优于自研这些安全敏感逻辑。业务创建权继续使用 `canCreateApp`，在受保护请求中实时读取 PostgreSQL。

Better Auth 官方 CLI 的重复管理员创建确认在非交互环境可能以退出码 0 返回，因此外层脚本必须先锁住数据库、检查用户表为空，并在创建后验证唯一管理员账号，不能仅依赖 CLI 返回码。
