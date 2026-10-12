# T01 状态：待远端 CI 验证

本分支是一个兼容性 Spike（技术试验），**不是已验证的业务 MVP**。

## 范围
- 同源 Next.js + TypeScript 基础、登录/退出 UI、服务端会话读取；
- Better Auth (关闭公开注册) + Drizzle + PostgreSQL 候选集成；
- Docker Compose 开发库、最小访问权限判定及单测；
- CI 验证安装、生成并执行候选迁移、TypeScript、Lint、测试、构建。

## 已知限制
- 提交环境不能访问 npm registry，尚未执行本地依赖安装与编译；
- 当前没有 lockfile 和经过审查的版本化迁移，不能合并到 master；
- 尚未实现管理员初始化、员工账号开通、禁用会话集成验证、业务登记或审批；
- 登录页依赖下一任务建立的管理员和员工账号，在此之前不能实际登录。

## T01 合并闸门
- CI 成功且日志可复核；
- 使用 Better Auth 官方 CLI 验证真实数据库 schema；
- 审查后补齐 pnpm-lock.yaml 及 drizzle/ 迁移文件；
- 验证匿名注册禁用、登录/退出、会话及停用账号拒绝；
- 重跑 typecheck、lint、test、build 和数据库迁移；
- 对每项验收标记 PASSED / FAILED / NOT RUN，禁止凭生成代码宣称完成；
- 审查通过后 squash merge，在 master 上保留一个语义清晰的提交。

参考 Issue #2、docs/engineering/AGENT_TASK_01.md。
