# T01 工程基础与认证验证记录

状态：**基础认证流程通过数据库集成测试；业务市场尚未实现；正式生产上线仍有安全阻断项**。

## 已实现
- Next.js 16.2 / React 19 / TypeScript 单体工程，锁定 pnpm-lock.yaml。
- Better Auth 1.7.6 + 官方 Admin 插件 + Drizzle / PostgreSQL 的登录、退出、管理员开通员工、禁用/恢复和 session 管理。
- 数据库锁保护的首个管理员初始化脚本，避免已有用户时再次初始化。
- 员工列表与账户管理 UI，应用创建权由单独服务器接口维护。
- PostgreSQL 版本化迁移、Docker Compose、本地说明、CI。
- 管理员/普通员工角色、权限撤销、账号封禁、禁止公开注册等集成测试。

## 真实 CI 证据
- [官方 schema 与迁移/构建基础验证](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38280124974)
- [管理员初始化、员工开通、登录退出和会话集成成功](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38321371834)
- [重复引导检查发现 CLI 不能仅靠退出码判断拒绝](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38321507870)
- [带数据库互斥锁的初始化脚本回归](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38321671638)

## 尚未交付 / 生产上线前必须解决
- [ ] 完整真实浏览器 E2E 回归（本轮完成的是 API/DB 集成测试与构建）。
- [ ] 强制首登改密、管理员密码重置和账号恢复流程。
- [ ] 防止通过直接调用管理 API 禁用/删除最后一个有效管理员（不能只靠隐藏按钮）。
- [ ] 审计安全敏感的员工创建、封禁、权限修改事件；生产环境登录限速与监控策略。
- [ ] 应用市场的创建、审批、上架、搜索和 AI 推荐（后续 T02+）。
- [ ] 正式部署平台的端到端兼容性、密钥、备份及安全检查。

## Git 交付
- 本轮所有源文件、锁文件、SQL 迁移、测试与文档在一个功能 PR 中验证。
- 清理临时生成迁移的工作流，在 CI 全绿后通过 Squash Merge 到 master。
- 后续任务按业务闭环新增 PR，不重写公开 master 的旧历史。
