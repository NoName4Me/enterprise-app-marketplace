# 技术架构和演进原则

当前使用 Next.js App Router + React/TypeScript（同源 UI/BFF/API）、PostgreSQL + Drizzle 迁移、Better Auth 独立认证；GitHub Actions/GHCR 云端 CI 镜像和 Mac mini OrbStack 本地实验。继续**模块化单体**，不急着前后端完全分离或微服务化。

```text
员工/维护者/未来审批与运维人员
 → Next.js 页面、API、服务端权限
   → PostgreSQL：市场、审核、收藏讨论、P1资产与生命周期
   → 外部 GitHub 仓库/流水线登记 + 私有工作台按需只读查询
GitHub Repo → Actions → GHCR ARM64 镜像 → Mac mini OrbStack 实验环境
P4+ 第三方监控/告警聚合；P5+ 独立 AI Worker/持久任务
```

市场登记与审核、治理生命周期、运行健康和部署状态是四条独立状态轴；只有已批准登记快照进入员工公开视图，待审版本不影响旧正式版。资产/环境/运维信息单独授权，见 [ASSETS](ASSETS.md)。

服务端必须校验账号状态、角色、创建权、资源 owner、操作与环境；隐藏前端按钮不等于授权。管理员不自然拥有生产部署权。业务关键状态用事务、约束及审计保证一致性。

门户聚合信息并提供受控入口，专业监控/日志/流水线仍留给原平台。未来 AI 负责理解、规划、编码、诊断，长期执行由独立 Worker/持久状态管理；确定性代码决定权限、风险/环境、版本绑定、幂等、执行及回滚校验。公共 PR 不连接本机高权限 Runner。技术缘由见 [ADR-001](decisions/ADR-001-technical-baseline.md)、[ADR-002](decisions/ADR-002-platform-evolution.md)。