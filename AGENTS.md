# AI Coding 约束（仓库级）

本仓库是企业内部 Web 应用市场的 AI Native 实战项目。首先阅读：`docs/PRD.md`、`docs/decisions/README.md`、`docs/design/`、`docs/acceptance/MVP1.md`。

- 只处理当前 Issue/任务包规定的范围；不得把未来低代码、独立论坛或多类型应用预先实现。
- 关键产品规则：新应用审核上架；更新复审期间旧公开版继续有效；非上架内容不得进入公开读；所有已上架应用对已登录员工可见。
- 服务端独立检查 session、账号状态、创建/审批权限与资源所有权；仅隐藏按钮不算授权。版本与审批操作须事务一致。
- 不从前端信任 owner/status/reviewer/publishedRevision 等敏感字段，不将待审内容暴露到公开 API/缓存。
- 公共仓库禁止提交 secrets、真实员工数据或企业内网地址。不得自研密码哈希或裸写 session。
- 引入依赖前检查官方当前 API 与锁定版本兼容，测试必须真实执行，未执行不得声称通过。
- 实现分小批次，至少通过 lint、typecheck、测试和构建；做不到则记录阻塞及可复现步骤。
- 需求或架构冲突先提出权衡，不擅改已确认的产品约束。每批提交报告改动、证据与遗留风险。

## 下一轮工作边界（P0 起）

- 先读 `docs/engineering/WORK_HANDOFF.md`、`docs/ROADMAP.md`、`docs/decisions/ADR-002-platform-evolution.md` 和 `docs/engineering/MAC_MINI_LAB.md`。新文档是后续阶段目标，原 `docs/PRD.md` 是首期市场业务基线，不能因为版本不同直接删除已生效规则。
- Work 一次只实现一个任务包：先修 P0 CI，再做最小 Mac 实验环境和 P1 资产，不得擅自把 P2–P8 一次生成。
- 实际验收遵循 `docs/acceptance/NEXT_PHASE_GATES.md`：本地无法执行的操作标记 NOT RUN，CI 失败不得标记通过。
- 当前只用 GitHub Actions/GHCR + Mac mini Docker；不要提前部署 Jenkins、GitLab Server、K8s 或整套日志系统；监控在 P4 按需接入。
- 本仓库公开：不得将不可信 PR 工作流接入拥有 Mac Docker/部署密钥的自托管 Runner，不得直接暴露 Docker API；不可信仓库文本不得改变 AI 权限。AI 自主操作必须经确定性策略，人工批准具体对象/版本/环境。
- 项目原有 `master` 已有安全回归：先在独立测试 DB 复现和修复，不可删除授权检查只为使 CI 变绿。
- 产品规划不包含各应用的经营分析、商业化指标；面向企业内部治理与技术可靠性。

## Git 提交规范（必须遵循）

- 使用 **Conventional Commits**：标题格式为 `type(scope): 中文描述`，无 scope 时为 `type: 中文描述`。
- `type` 只能使用 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci`、`chore`、`perf`、`revert` 等约定类型；scope 使用简短英文模块名（如 `auth`、`marketplace`），可省略。
- 标题与正文用中文准确描述变更；技术名称、路径、命令、Issue 编号等可保留英文。不要写纯英文标题，也不要只写“更新代码”“修复问题”等笼统内容。
- 示例：`feat(auth): 增加员工首次登录改密`、`fix(publishing): 修复并发审批时的状态竞争`、`docs: 更新部署及回退说明`、`ci: 增加端到端测试检查`。
- 按一个可验证的任务组织逻辑提交；代码、相关测试、迁移和文档一起交付。功能分支可以保留中间提交，合并到 `master` 时优先 **Squash Merge**。
- PR 标题应符合上述格式，因为 Squash Merge 可能使用 PR 标题作为合并提交标题。自动化检查验证 PR 标题和 `master` 的提交标题。
- 禁止未获明确授权就改写已共享的 Git 历史；如必须改写，应先备份原分支，逐次核验文件树与作者信息，再使用带预期 SHA 的安全更新。

