# 认证与管理员初始化

当前 T01 分支使用 Better Auth 1.7.6 Admin 插件和独立 PostgreSQL，禁用任何公开用户注册。

## 管理员一次性初始化

在**新的空数据库**完成受控迁移之后，使用官方 CLI（不要把生产密码写在 Shell 命令历史或 GitHub Issue 中）：

```sh
pnpm db:migrate
node scripts/bootstrap-admin.mjs --email admin@example.com --name Admin
```

脚本会使用 PostgreSQL advisory lock 保证初始化互斥，并在调用官方 Better Auth CLI 前要求用户表为空。CLI 使用交互模式读取密码；脚本不会将真实密码放在命令参数中。**不要**使用 `--password <secret>` 传真实密码；不要在生产数据库调用 `--force`、`--yes` 绕过已有用户的确认。

本命令仍须在 CI 的隔离 PostgreSQL 中验证；若 CLI 版本不支持或与 Drizzle 配置冲突，停止执行并按证据修订方案。

## 创建员工

管理员登录后进入 `/admin/users`，调用 Better Auth Admin 插件创建员工账号。应通过安全渠道提供初始凭据，新账号首次登录强制改密，管理员可生成 15 分钟内有效的一次性重置链接，见 [账号安全交付](ACCOUNT_SECURITY.md)。

管理员可为指定员工授予/撤销 `canCreateApp`。这项业务权限由应用服务端在**每次受保护请求**时重新读取数据库，不信任 session 中的旧角色字段。

对员工账号封禁、恢复和会话撤销优先使用 Better Auth Admin 插件，避免直接编写密码和 session 逻辑。禁用账号的实际浏览器访问也需要额外的端到端烟测。

## 安全要求

- 外部访问必须 HTTPS；`.env`、数据库密码及 Better Auth secret 不得提交仓库。
- `/admin/users` 的数据展示及业务权限写入均须在服务端鉴权。
- 有后台 API 的管理员权限验证，不得仅依赖 React 条件渲染。
- 首登改密、受控重置、账号审计、限速及最后管理员保护已实现；正式环境启用前落实 HTTPS、可信代理及数据库权限隔离。
- 不使用真实企业账户作为公开 GitHub Actions 测试夹具。

### 重复初始化防护的实测依据

Better Auth 1.7.6 的 create-admin 命令在已有用户且 CI 无 TTY 时可能显示确认提示后以 0 退出，因此 **不能将其退出码当作重复创建防护**。本项目脚本在 DB 锁内做实际用户数检查；即使 CLI 自身行为变化，也不会重用已初始化数据库。
