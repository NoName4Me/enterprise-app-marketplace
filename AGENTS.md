# AI / Work 工程协作规范

**优先业务功能交付**，不把教程、开源代码或旧设计默认当最佳实践。先读 [PRODUCT](docs/PRODUCT.md)、[ROADMAP](docs/ROADMAP.md)、[ARCHITECTURE](docs/ARCHITECTURE.md)，资产看 [ASSETS](docs/ASSETS.md)，环境看 [DEVELOPMENT](docs/DEVELOPMENT.md)，测试见 [QUALITY](docs/QUALITY.md)。

- 每轮完成一条可演示的主流程；普通 UI/CRUD 不强制新增自动化测试，既有测试保留。涉及权限、认证、审批、DB 迁移、外部执行必须保留最小防护/验证，不为提速删除服务端安全逻辑。
- 不再为每个任务新增独立 PLAN、DESIGN、STATUS、ACCEPTANCE、DELIVERY 文档；执行内容与证据写 PR/CI，长期规则才入 docs。未运行的检查写 NOT RUN，失败写 FAIL。
- 已上架应用的待审版本不改变旧公开版本；未审核内容不得公开；所有权限从当前登录账号/资源归属服务端判断，申请人不得自审，管理员不自动拥有生产执行权限。
- 用户 Mac mini OrbStack 已有数据库；不得 `down -v`、`volume prune`、重置开发库或擅自覆盖 `.env`；不提交密码、员工数据或真实内部地址。
- 不把公开 GitHub PR 交给有本机部署凭据的 Self-hosted Runner；GHCR 仅接受经确认的 master 完整 CI + 手动发布，AI 不能自行授予高风险操作权限。
- 技术选型须独立评估正确性、时效性、Bug 和替代方案；重要产品/不可逆架构变更集中评审，普通实现由 Work 自主处理。

Git 标题：中文 Conventional Commits，如 `feat(scope): 中文说明`、`fix(scope): 中文说明`，允许 feat/fix/docs/refactor/test/build/ci/chore/perf/revert。PR 标题同规范，优先 Squash；必需 GitHub checks `check`/`validate` 不可无故改名。