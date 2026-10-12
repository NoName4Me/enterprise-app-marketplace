# T01 状态：依赖和迁移兼容性通过，完整身份闭环待验收

本分支是一个兼容性 Spike（技术试验），**不是已验证的业务 MVP**。

## 范围
- 同源 Next.js + TypeScript 基础、登录/退出 UI、服务端会话读取；
- Better Auth (关闭公开注册) + Drizzle + PostgreSQL 候选集成；
- Docker Compose 开发库、最小访问权限判定及单测；
- CI 验证安装、生成并执行候选迁移、TypeScript、Lint、测试、构建。

## 已知限制
- 提交环境不能访问 npm registry，尚未执行本地依赖安装与编译；
- 已由隔离 GitHub Actions 生成并提交 pnpm-lock.yaml 与版本化 drizzle/ 迁移；完整登录、管理员初始化等验收仍未完成，不可直接合并；
- 尚未实现管理员初始化、员工账号开通、禁用会话集成验证、业务登记或审批；
- 登录页依赖下一任务建立的管理员和员工账号，在此之前不能实际登录。

## T01 合并闸门
- [x] 冻结锁文件 CI 成功且日志可复核；
- [ ] 校验认证 schema：`auth@1.7.6 check schema` 对当前 Drizzle adapter 报 `Schema validation is not available`（不等于 schema 正确）。已改为生成官方参考 schema 并与现有结构对比；真实认证写入/会话集成测试仍需扩充。
- [x] 已补齐 pnpm-lock.yaml 与 drizzle/ 迁移文件，冻结锁文件 CI 验证成功；
- [ ] 匿名注册拒绝的 DB 集成测试已通过；登录/退出、真实会话及停用账号拒绝仍待覆盖；
- 重跑 typecheck、lint、test、build 和数据库迁移；
- 对每项验收标记 PASSED / FAILED / NOT RUN，禁止凭生成代码宣称完成；
- 审查通过后 squash merge，在 master 上保留一个语义清晰的提交。

参考 Issue #2、docs/engineering/AGENT_TASK_01.md。

## 2026-10-13 CI 证据

- [首次兼容性 CI 成功](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38278705629)：安装、迁移、typecheck、lint、单元测试、构建均通过。
- [后续兼容性 CI](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38279185507)：新增数据库集成测试通过；单测脚本由于匹配到 integration 测试而错误退出，已修正测试隔离范围并安排冻结锁文件复验。
- 以上通过项均不代表登录成功、账号停用等端到端验收完成。

- [冻结锁文件及数据库集成测试 CI 成功](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38279380263)：包含迁移无漂移、禁止匿名注册数据库集成测试、typecheck、lint、unit、build。

- [官方 schema check 的失败记录](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38279575871)：CLI 因当前适配器无法提供检查而退出 2；不能当作字段校验失败，也不能当作验收通过。
