# ADR-002：企业应用治理与 AI 自动化运维平台演进

- 日期：2026-10-13
- 状态：**已确认目标架构原则；具体第三方凭据、流程框架和权限实现方案待各阶段 Spike/ADR 决定**
- 关联：[ADR-001 原 MVP 技术基线](ADR-001-technical-baseline.md)、[路线图](../ROADMAP.md)、[环境](../engineering/MAC_MINI_LAB.md)

## 决策背景

现有项目以 Next.js 16 + React 19 + TypeScript、PostgreSQL/Drizzle、Better Auth、Docker 和 GitHub Actions 实现企业 Web 应用市场。计划扩展到应用全生命周期、使用权限申请、需求中心、真实 AI 发现、CI/CD/监控聚合、人机接力的 AI 编码、部署和故障恢复。内部非营利性质，不处理各业务应用自身经营分析。

## 结论：体验一体化，不把专业能力全部收进一个运行进程

- **统一 UX**：员工、开发者、运维、审批人、管理员共享 Shell、搜索、通知和个人待办；专业工作台独立组织，可多职责、可设默认入口。
- **统一应用资产关系**：以应用、组件、环境、负责人、关联第三方资源为连接点；如果公司已有 CMDB，必须先明确谁是某项资产的权威来源，不做冲突双主写。
- **模块化单体仍适用**：Next.js 负责 UI、同源 BFF 和当前低复杂度领域 API，PostgreSQL 保持事务一致性；不因“未来会用 AI”就立即拆 SPA + NestJS 或重写微服务。
- **长任务独立执行**：模型调用、编码沙箱、部署编排、任务持续等待或轮询不能依赖 Next.js 请求生命周期；到 P5 时使用独立 Worker 与持久状态存储，按恢复实测决定是否引入 Temporal / LangGraph / Agents SDK 等。
- **三方工具只做对接**：GitHub/GitHub Actions/GHCR 提供真实托管、CI 和镜像；Mac mini Docker 提供可控部署目标；Prometheus/Grafana/Alertmanager 在 P4 按需接入；Jenkins、GitLab Server 和自建 Git 服务当前都不安装。
- **运维深度**：L1 统一真实运行与变更信息为主，L2 只按频率、可控性和风险逐项开放高价值受控操作；专业日志/监控/流水线设置深度链接到原平台；不复制 L3 专业运维工具。

## 逻辑架构

```text
员工 / 维护者 / 运维 / 审批人 / 管理员
  -> Next.js Portal：统一 Shell / 市场 / 需求 / 工作台 / API-BFF
       -> 领域模块：Catalog / Asset / Lifecycle / Access / Demand / Ops
       -> PostgreSQL：业务事实、资源关系、待办、审批、审计、任务引用
       -> Integration adapters (只暴露允许的能力)
            -> GitHub Repo + Actions + GHCR [云]
            -> Mac mini: deploy coordinator / test apps [本地]
            -> Prometheus / Alertmanager / Grafana [后续按需]
       -> Task/Policy layer [P5]
            -> Durable Workflow / human tasks / policy / audit
            -> AI worker + isolated coding environment
            -> Fixed-action executor（不允许任意生产 shell）
```

以上是**职责与逻辑边界**，不是微服务部署图。P0–P4 不需要提前创建空壳 Workflow Service。

## 数据与版本所有权

| 事实 | 权威来源 / 同步要求 |
| --- | --- |
| 已上架登记快照、审核历史、用户偏好 | 门户数据库 |
| 应用生命阶段、维护责任 | 门户起步；如未来接 CMDB，明确可写方及同步策略 |
| 实际仓库提交 SHA / PR / CI Job | GitHub API |
| 镜像身份 | GHCR 的不可变 digest（不能只保存 latest） |
| 部署时间、目标环境、容器状态、回滚结果 | 本地部署协调端的真实确认及审计 |
| 运行健康/告警 | 监控系统，必须保留来源、采样时间、采集失败时的 UNKNOWN |
| 门户批准的使用申请 | 门户；目标系统已授权另行记录/确认，不能自动画等号 |

P1 模型至少区分 Application、Component、Environment、Team/Owner、ExternalIntegration。无运行集成的应用也能正常登记；非上架应用不得因为资产建模而泄露；项目原来的已审批版本和外部部署版本不得合并成一个字段。共享组件、服务依赖的权限与可见性必须独立校验。

## 安全边界

1. 公共 GitHub 仓库的 PR 在标准云端 Runner 上测试，**不把 Mac mini 注册成可执行任意 PR 代码的自托管 Runner**。
2. CI 只运行构建与测试，采用最小 `GITHUB_TOKEN` 权限；发布镜像只限受信任来源，必要时隔离受保护发布工作流，记录代码 SHA / digest / 测试运行 ID；先修 CI 再考虑自动发布。
3. Mac mini 初期**手动拉取经过验证的镜像 digest**，在本地独立部署；后续如做拉取式部署协调，必须具备允许仓库/环境/版本列表、身份验证、回放保护、幂等、执行限次、验证与回滚。绝不直接向公网暴露 Docker Socket、Docker TCP API 或生产管理接口。
4. 本地 Docker 网络与绑定地址尽量仅 localhost / 专用网络；数据库、监控和执行端不暴露公网，不能把公开仓库的固定测试口令当成真实凭据。
5. 后续人机协作：AI 不能自行决定权限等级或绕过审批；风险由确定性策略组合操作、环境、对象、变更范围决定。审批绑定具体代码 SHA、环境、参数和有效期，超期/版本变更需重新授权。
6. Worker 异步结果和外部回调必须处理重复、丢失、乱序、超时和取消。接管后恢复需重新读取 Git/CI/部署实况，禁止沿用旧审批或过时状态。
7. 保留租户边界和最小权限；生产高风险数据库/身份变更默认人工授权，即使低风险自动发布成熟也不放宽。
8. 禁止把外部 Issue、日志、仓库文档中的文本当作可信 Agent 指令；AI 代码执行需要隔离运行时与受限密钥。

## 不采用的替代

| 选择 | 不采用原因 | 未来重新评估条件 |
| --- | --- | --- |
| 前后端完全分离或全量 NestJS 重构 | 当前既有业务在 Next.js 内稳定组织；收益不能证明覆盖迁移成本 | 独立 API 使用者、部署隔离、团队边界明确 |
| 一次性拆成微服务 | 增加运维/分布式事务成本 | 可靠性或伸缩差异有数据支持 |
| 现在部署 Jenkins 或 GitLab Server | GitHub 已能提供真实仓库、PR、CI 和 GHCR | 有明确第二提供商/遗留企业系统验证需求 |
| 现在上 Kubernetes / 日志集群 | Mac 16GB/256GB 且实验目标是闭环，不是基础设施容量验证 | 真实部署规模或团队需求改变 |
| 立刻决定 Temporal + LangGraph | 两者部分能力重叠，尚无实际恢复/人机等待 PoC | P5 用任务失败场景做技术决策 |
| 纯 Mock 演示 | 无法证明真实部署、告警及回滚链路 | 仅限前期 UI 契约测试并明确标识 Mock |

## 后续具体选择与终止条件

- P0：保护分支和 CI 失败需显式阻断发布；不得降级授权规则换取 CI 绿灯。
- P1：逐个 Application 真实关联一个 Component、一个环境和 GitHub 外部对象；先查现有数据模型，避免重复 schema。
- LAB：Apple Silicon `linux/arm64` 镜像在本机可运行，演示指定 digest 发布及回滚。
- P4：端到端监控与告警有真实采样、来源与时效；数据未接入标记 UNKNOWN。
- P5：Worker 重启、长时间人工暂停、外部回调重复、重试不会造成重复部署后再扩大自治。

相关官方参考：
- Next.js BFF：https://nextjs.org/docs/app/guides/backend-for-frontend
- GitHub Actions：https://docs.github.com/en/actions/concepts/billing-and-usage
- GitHub Container registry：https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- GitHub 公共仓库 Runner 安全：https://docs.github.com/en/actions/reference/security/secure-use
