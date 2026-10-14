# Work 执行总入口：下一轮落地任务包

- 2026-10-13 版本；**在代码与环境动手前，先读本文件及关联文档**。
- 仓库：`NoName4Me/enterprise-app-marketplace`，主分支 `master`；现有业务代码为事实来源，不假设旧教程或生成代码正确。
- 执行基线：[新路线图](../ROADMAP.md)、[候选需求](../product/EXPANSION_BACKLOG.md)、[架构 ADR](../decisions/ADR-002-platform-evolution.md)、[Mac mini 实验方案](MAC_MINI_LAB.md)、[验收](../acceptance/NEXT_PHASE_GATES.md)。
- 每次 Work 只领取下述**一个可验收任务包**；不要在同一次任务里提前实现 P1–P8。用户要求中文 Conventional Commits（`type(scope): 中文说明`）、小范围可验证变更、GitHub 真实检查。
- 2026-10-14补充：P0-T01已由PR #15修复并全量CI通过；P0-T02代码由PR #16交付，真实分支保护和失败合并负例已闭环。LAB-T00/T01已在OrbStack本机实测；**GHCR/digest LAB-T02已有可信发布与受限部署配置，真实链路证据须执行后补充**。详见P0_T02.md与LAB_T01.md。

## 开始前的统一检查（每个任务都做）

1. `git fetch` 并查看最新 `master`、当前分支、未提交变更、PR、已有 docs 与 workflow；本文记录的 SHA 仅作为写文档时的观察值，**不能固定当作最新**。
2. 阅读 `AGENTS.md`、受影响的现有代码、测试、数据库迁移和对应 ADR；对版本、CLI 和第三方 API 重新核对官方文档。
3. 先说明预期改动的文件、不可触碰的数据/密钥/生产环境以及验收方法；默认不直接推送可能影响他人工作的 `master`。
4. 建立功能分支，完成当前任务范围的实现和验证后开 PR；只有用户明确要求“直接提交 master”的特定文档任务例外。
5. 报告实际命令与退出状态、运行链接/截图/测试日志；没执行就标 `NOT RUN`，失败标 `FAILED`。不能把先前版本 CI 通过当作本版本证据。
6. 出现权限不足、端口冲突、生产权限/密钥风险、原测试数据可能被破坏或不确定的架构选择时，停止风险操作并给出最小可复现阻塞说明。

## P0-T01：恢复 CI / 管理员初始化（**第一项编码任务**）

**已观察事实**：最近主分支 CI 运行 https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38386790784 在 `Bootstrap initial administrator (isolated fixture database)` 失败，后续验证被跳过。历史日志曾显示 `敏感字段必须使用专用管理入口`，疑似 Better Auth `/admin/create-user` 防护先于可信 CLI 例外执行；这只是排查线索，**先在最新代码复核，不可当作已证实的修复方案**。

**执行要求**：
- 在独立 PostgreSQL fixture 上复现失败；检查 `scripts/bootstrap-admin.mjs`、`src/lib/auth.ts` 的路由钩子、Better Auth 官方管理 API/CLI 调用路径、当前版本兼容性。
- 设计能明确区分可信服务端 bootstrap 和不可信 HTTP 入站请求的受控路径；拒绝通过“删除敏感字段防护”恢复绿色；若现有绕过条件依赖 `!ctx.request` 等不可靠特征，独立分析替代方案。
- 回归：空表初始化成功、非空表禁止重复创建、普通用户越权写入管理员/敏感字段被拒、最后管理员保护仍有效、会话/首登改密/重置与审计/限速不回归。
- 运行真实 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:db`、`pnpm build` 与已定义的 Chromium E2E、容器 smoke（必要环境就位时）。最终**新 commit 的 GitHub Actions 全量通过**才能标绿。
- 不修改与 CI 故障无关的业务功能；如官方 CLI 与安全约束根本冲突，先提交权衡说明及最小 PoC，别通过弱化安全解决。
- 交付：独立 PR、根因说明、测试证据、回归用例与风险。

## P0-T02：真正的合并门禁与执行边界

**必须在 P0-T01 之后开展。**

- 检查 `commit-message-convention.yml` 与业务 CI，确认 PR 标题与代码检查实际触发且报告正确。
- 调查是否已经配置受保护分支/规则集、必需状态检查、禁止绕过、PR 合并策略；如 GitHub App 权限不足或需用户网页操作，列精确设置步骤，**不能以 workflow 存在替代分支保护**。
- 确保不可信 PR 不获得镜像发布、部署或本机凭据；最小化 `GITHUB_TOKEN` 默认权限；检查 Dependabot/依赖安全、关键日志是否泄漏凭据。
- 交付：门禁实测、越权或失败测试、对应安全检查项清单。未配置成功的保护明确标 `BLOCKED`。

## LAB-T00/T01：Mac mini 设备清点与最小运行环境

**先确认 Mac 环境可访问。** Work 若运行在云端而无法访问用户 Mac 的 OrbStack/Docker，不得假称“已部署本地”。允许产出可执行配置与本地验证指令，证据待用户 Mac 执行再闭环。

- 根据 [Mac mini 运行手册](MAC_MINI_LAB.md) 检查 M4/16GB/256GB、Docker 架构/内存/磁盘、端口、Node 和 pnpm、已有容器/数据库。
- 只复用或增量改进现有 PostgreSQL compose，并提供独立测试数据；不安装 Jenkins/GitLab/K8s。
- 创建简短可观测的实验业务服务（可单独 demo 目录/独立测试仓库，先评估现有结构），有 `/health` 和 `/version`，允许在受限环境注入可恢复故障。
- 交付：本地健康检查、干净环境启动与停止说明、数据持久性/隔离、内存磁盘实际测量；不要先接入生产式多套观测平台。

## LAB-T02：真实镜像构建、Mac 部署与回滚

**前置：P0 绿灯 + LAB-T01 验证通过。**

- 用 GitHub Actions **可信来源**构建实验应用 `linux/arm64` 镜像并发布到 GHCR（根据权限可选择 public/package），保留 Commit SHA、workflow run URL、镜像 digest 证据；验证 package 与仓库的访问设置。
- Mac mini 本机通过 digest 拉取并手动部署，检查服务版本、容器运行、端口、健康检查，记录发布步骤与成功/失败时间线；再用上一 digest 回滚。
- 要求清晰处理拉取失败、容量不足、部署失败、健康检测失败；数据迁移不能通过回滚镜像自动撤销。
- 不部署公网服务、不绑定公共 PR Runner、不使用任意远程 Shell、暂不实现无人值守生产部署；需自动部署时另开安全评审任务。
- 交付：单次真实端到端链路证明、最小 compose/工作流/操作说明、失败与回滚记录。

## P1-T01：应用资产与生命周期设计，然后再实施

**P0 绿灯是代码合并前置；数据模型变更不抢跑。**

- 先审查当前 `src/db`、`src/domain/app-service.ts`、`src/app/my`、审核与公开目录接口，确保保留现有应用审批快照模型和隐私边界。
- 输出 Application/Component/Environment/Owner/Integration 的**最小**可扩展结构和历史数据兼容迁移；支持一个应用多组件/多环境、不依赖 CI 接入也能登记。
- 生命周期变更的所有权、权限、并发冲突、退役影响检查、审计、工作台结构形成可执行验收。区别运营视角/运维敏感信息，不直接显示真实生产内网地址给所有员工。
- 实施时拆小 PR，先资产数据和 API，再生命周期规则和工作台；不得借机重写完整应用市场或扩充论坛。
- 交付：设计、迁移方案、服务端验证、单元/集成/E2E、角色隔离验收。

## 后续任务模板（P2–P8）

- P2 统一申请/审批：业务状态与通用待办分离；核对目标系统真实授权 vs 门户审批。
- P3 需求与 AI 发现：需求独立于执行任务，AI 只从有效登记信息解释推荐，先有评测集。
- P4 运维 L1：开始接 Prometheus/Alertmanager/Grafana，真实来源及 STALE/UNKNOWN。
- P5 AI 人机接力：用单个低风险 Bug 验证持久化 Worker、中断/续跑、人工改 Git 后重新读取状态；以故障测试决定编排框架。
- P6 AI 自动需求交付：隔离工作区 → PR → CI → 策略 → 测试部署，先不开放生产自动写入。
- P7 AI 运维：检测 → 诊断 → 受控动作/转人工 → 恢复验证，L2 根据真实频率与风险增减。
- P8 仅在上游可靠性证据支持时开展从零应用创建与更高自治。

## Work 每批最终报告格式

- 目标/实施范围、实际变更文件、仓库 SHA、PR 链接；
- 实际运行环境（本地 Mac / GitHub 云端 / 演示配置），区分 TESTED 与 NOT RUN；
- 测试命令、结果、日志/证据链接；包含失败路径及回滚/清理结果；
- 安全与权限边界、已知缺陷、阻塞和后续 **唯一** 推荐任务；
- 若缺少 Mac 的实际执行权限，只报告“已准备配置，待本机验证”，不要捏造成功。
