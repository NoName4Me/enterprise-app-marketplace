# T01 实施与验证记录

状态：**技术骨架和数据库兼容性验证通过；完整登录与管理员初始化尚待完成**。本分支为 Draft PR #3，不代表业务 MVP 已交付。

## 已实现

- 同源 Next.js + TypeScript Web 工程及独立登录页；
- Better Auth 邮箱密码登录 API 和客户端表单、公开注册关闭；
- PostgreSQL + Drizzle 数据访问层、开发 Compose 和初始版本化 SQL 迁移；
- 认证表结构按 Better Auth 1.7.6 官方 CLI 生成结果校正，包含关联索引、relations、updatedAt 行为；
- `pnpm-lock.yaml` 锁定完整传递依赖；
- 服务端检查活跃 session + 账号禁用状态的最小入口（尚未覆盖所有后续 API）；
- 最小权限策略单元测试、匿名注册数据库集成测试；
- GitHub Actions 包含冻结锁文件、迁移生成无漂移、真实 PostgreSQL 迁移、测试和构建。

## 已验证证据

| 内容 | 状态 | 证据 |
| --- | --- | --- |
| 基础依赖安装、迁移生成与应用 | PASS | [首次 CI](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38278705629) |
| 单元测试配置问题修复 | PASS | [冻结锁文件 CI](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38279380263) |
| 禁止匿名注册的 DB 集成测试 | PASS | [冻结锁文件 CI](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38279380263) |
| 完整类型检查、Lint、单元测试和构建 | PASS | [冻结锁文件 CI](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38279380263) |
| Better Auth 生成参考 schema | PASS | [官方 schema 生成 CI](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38279805002) |
| 官方 `auth check schema` 对 Drizzle | UNSUPPORTED | [实测记录](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38279575871)；工具明确报告当前适配器不支持检查，不能将此解释为 schema 已验证 |
| 初始迁移与官方 schema 差异修正 | 已提交、最终回归待验证 | 功能分支，最新 CI |

## 尚未通过的验收

- [ ] 安全的一次性管理员初始化及员工账号开通。
- [ ] 真实用户登录 → 会话持久 → 退出及失效的 API/E2E 测试。
- [ ] 停用账号后旧 Session 不再可用、权限撤销实时生效的集成测试。
- [ ] Better Auth 与 Drizzle 的完整认证读写路径验证，包括负面案例。
- [ ] 建立并验证可复现的本地运行与数据库迁移说明；补充需要的依赖安全审查。
- [ ] 依据全部验收标准做独立评审。

## 约束与后续

当前公开注册禁用，**没有管理员或员工初始化工具**，因此登录 UI 暂无有效测试用户。不能向用户宣传已经具备可交付的账户系统。

首次的 Better Auth schema 是人工编写的，虽能迁移、构建和禁止公开注册，却遗漏了关联索引和更新时间规则；官方 CLI 生成参考后已修正为一致结构。这是对“运行成功不等于设计正确”的一次实际案例。

下一步先实现受控管理员初始化、账号开通、认证集成测试。项目还不包含应用上架和审批业务。

Git 合并规则：本功能分支即使经历若干修复提交，合并到 `master` 时采用 squash，形成单个逻辑提交；不改写已发布 `master` 历史。
