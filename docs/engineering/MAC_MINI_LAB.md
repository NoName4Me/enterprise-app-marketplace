# Mac mini M4 实验服务器与云端 CI 混合环境

- 日期：2026-10-13；状态：**LAB-T00/T01 已在用户 Mac mini/OrbStack 实测；GHCR/digest 部署 LAB-T02 仍 BLOCKED**。详见 [本机证据](LAB_T01.md)。
- 硬件：Apple Silicon M4，统一内存 16GB，内部存储 256GB。
- 目标：**真实模拟单机应用从需求/代码 → GitHub CI → 镜像 → 本地部署 → 监控告警 → 诊断/修复 → 发布验证**；不是复刻企业多集群高可用灾备。
- 原则：最小可复现、分层启用、隔离测试数据、保留停止/回滚路径。

## 选型表：只安装必需的

| 组件 | 放哪里 | 启动阶段 | 理由 |
| --- | --- | --- | --- |
| Git 仓库、PR、Issue | GitHub.com（既有） | 已可用 | 不运行 Git Server |
| 测试构建、代码检查、容器构建 | GitHub-hosted Actions（既有） | P0/LAB | 不安装 Jenkins；公开仓库标准 Runner 免费，仍需核对使用限制 |
| 镜像仓库 | GHCR | LAB-T02 | 镜像以 digest 部署；Work 核对实际访问策略和额度 |
| 门户开发进程 | macOS Node/pnpm（先用现有） | P0/LAB | 减少 Docker 内构建与热更新开销 |
| 门户数据库 | Docker PostgreSQL（仓库已有 compose.yaml） | LAB-T01 | 本地开发数据卷，另建隔离测试 DB |
| 可部署的**实验业务应用** | Docker 容器 | LAB-T01/02 | 具备 /health、版本、可制造故障和回滚案例 |
| 部署协调 | 先**人工按 digest 部署**，后续受控本地 Worker | LAB-T02→P4/P5 | 不直接开放网络 Docker API，也不接公开 PR Runner |
| Prometheus、Alertmanager | Docker 可选 profile 或独立 compose | P4 | 小保留期指标与告警，真实采样 |
| Grafana | 本地 Docker 可选或 Grafana Cloud Free | P4 | 主要提供深度链接，按需安装 |
| AI Worker / 编码沙箱 | 后续本地独立进程/容器；模型可云 API | P5/P6 | 与 Web 请求生命周期隔离 |
| Jenkins、GitLab Server、K8s、OpenSearch | **不安装** | 不在当前范围 | 成熟第三方功能由现有在线服务承担 |

### 为什么云端 GitHub + 本地 Mac 已能形成真链路？

GitHub Actions 执行真实测试与容器构建，并推送 GHCR。Mac mini 主动从 GHCR 拉取指定镜像 **digest**，在 Docker 中部署并运行目标服务；本地监控抓取目标服务指标，由告警路由到门户，后续 AI Worker 做诊断和受控修复。无需把 Git 仓库迁移到自建 GitLab/Jenkins，也无需云端 CI 能主动 SSH 进入家中机器。

初期不要追求“一推送就自动部署”：先人工按既定验证结果拉取并测试，记录镜像、执行时间和回滚证据；自动部署在安全控制成熟后再打开。

## 设备可行性与资源预算（Work 必须测量，不是固定占用）

- Mac mini 16GB 适合少量低负载 Node/Postgres/监控容器 + 云端构建；**不同时运行本地大模型、多个重度构建器和完整 GitLab**。
- OrbStack 的 Linux VM 可先设置约 **6–8GB** 内存上限，留给 macOS/IDE/浏览器足够余量；仅为初始试验值，观察 `docker stats` 与系统内存压力后调整。
- Docker 镜像/卷磁盘上限可先按约 **35–50GB** 规划；OrbStack 上限不等于已经写入这些数据。定期检查 `docker system df`，不要执行破坏性全卷清理；将备份单独保存。
- 监控只保留短期演示指标（如 3–7 天），限制日志量和容器数量。实际总占用以运行证据为准。
- Apple Silicon 镜像需支持 `linux/arm64`；GitHub `ubuntu-latest` 默认使用 x64，LAB-T02 必须显式验证 arm64 构建：可评估 `ubuntu-24.04-arm` Runner 或 Buildx 多架构构建，**不能直接假设 x64 制品在 M4 本机原生运行**。

## 隔离与访问安全

1. 只在本人 Mac/可信局域网运行。数据库、Grafana、部署协调与监控接口默认绑定本机/专用网络；无需暴露公网、映射路由器端口。
2. **严禁**把 GitHub 公共仓库中 PR 可触发的 workflow 绑定到有本地 Docker/凭据权限的 Self-hosted Runner。初期只用 GitHub 云端 Runner。
3. CI 的 `GITHUB_TOKEN` 仅按 job 需要授予 read/write package 权限。发布镜像只由可信分支/版本触发；不能让不可信 PR 向共享镜像名称覆盖发布版本。
4. GHCR 的 package visibility 与 repo visibility 可以独立配置。拉取 private 镜像时另行选取最小 `read:packages` 的凭据，存在 Mac 本地非仓库密钥位置；不要在仓库、镜像 Dockerfile、截图或任务日志中记录。
5. 部署以镜像 digest 为身份，保留上一可用 digest；从 GHCR 读取的仅是**构建结果**，部署需本地健康检查、实际版本校验与回滚能力。
6. Docker Socket 与宿主机 Shell 属高风险；若后来要做自动拉取式部署，不提供任意 Shell/镜像/路径/仓库输入，使用有允许列表和签名/授权机制的部署 Agent。
7. Postgres `compose.yaml` 里的 `localdev` 只适合当前受控本机开发；开发、自动化测试和部署演练不得共享数据库或登录密钥。不得导入真实员工数据。
8. 运行器和镜像安全策略不能单靠 AI 判断；发布前 CI 状态、Commit SHA、digest 和环境批准状态必须由确定性程序检验。
9. OrbStack 许可因个人/商业用途而异；若转入公司实际部署，应核对官方许可证。Mac 上的 OrbStack 运行 Linux 虚拟机，不代表原生 Linux 生产主机兼容性已经完全验证。

## 分阶段环境建设

### LAB-T00：设备检查（无代码改动）

Work 在能访问 Mac mini 的环境中核对：
```sh
uname -m
sw_vers
docker version
docker compose version
docker info --format '{{.OSType}}/{{.Architecture}}'
docker system df
node --version
corepack pnpm --version
```
确认是 `arm64`、Docker 处于可用状态、剩余磁盘容量足够、PostgreSQL 5432 和门户 3000 端口没有冲突；不擅自清空原有容器/卷，检查现有数据库数据是否需要保留。工具未安装时先说明所需安装方式和平台限制。

### LAB-T01：最小本地基础

- 复用仓库 `compose.yaml` 的 PostgreSQL，不修改为一个集成全部第三方的巨型 compose。
- 单独建立**隔离**测试数据库或容器；明确迁移命令不会误操作已有开发数据。
- 选取一个低资源实验服务（独立小项目或受控仓库目录），含 /health、/version 和可重复注入但只在测试环境启用的故障机制。
- 本机确认 `docker compose up -d`、PostgreSQL health、门户运行、测试服务 health；记录 memory/disk。
- **停止条件**：与已有本地端口/数据库冲突、无法确定安全数据隔离、空间不足、已有卷不明时停止，不自作主张删除。

### LAB-T02：GitHub Actions → GHCR → Mac mini（真实端到端）

- PR 上执行普通检查；在可信来源且 CI 通过后，单独构建/推送带 SHA 标识的 arm64 镜像，记录 workflow run、源 Commit SHA、镜像 digest 和权限。
- GitHub workflow 可使用 Buildx；如果 arm64 Runner 可用可实测；无需先自建 Runner。
- Mac 手动 `docker pull ghcr.io/<owner>/<image>@sha256:<digest>`（占位语法）；按 digest 更新**测试服务**，查看应用返回对应版本，做烟测。
- 引入故障版本并运行回滚（应能用前一个 digest 恢复）；记录部署失败时现有服务保留/恢复策略。
- 本批**不允许**自动对生产推送部署、不对外开放 Docker API、不允许未知提交覆盖部署目标。
- 若 GHCR 权限、实际 Runner 架构、构建平台不兼容，输出证据和替代方案后暂停自动化。

### P4-LAB：真实监控和告警

- 在测试服务接入 Prometheus 指标/健康采样，通过 Alertmanager 产生并解除真实的故障告警；Grafana 只做查看或可选 Cloud。
- 演示应用版本、告警、关联服务、监控最后更新时间、跳转 URL；网络断开后状态降级到 UNKNOWN/STALE。
- 监控量与保留期受限；采集的指标与故障必须可以重现，禁止使用硬编码绿色卡片冒充监控接通。

## 真实与模拟的区别

“本地部署的第三方组件”是**真实执行的实验环境**；应用故障可能是人为注入，但采集/告警/执行/恢复链路必须真实。不得因为在测试环境模拟故障，就声称证明了生产可靠性、容灾、企业网络安全或无人监管自治能力。

## 官方参考（Work 执行前需重新校验版本、价格、访问条款）

- GitHub Actions 用量：https://docs.github.com/en/actions/concepts/billing-and-usage
- GitHub Runner 架构：https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- GHCR：https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- GitHub Actions 容器发布：https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images
- GitHub Self-hosted Runner 安全：https://docs.github.com/en/actions/reference/security/secure-use
- OrbStack Docker：https://docs.orbstack.dev/docker/
- OrbStack 设置：https://docs.orbstack.dev/settings
- Prometheus：https://prometheus.io/docs/introduction/overview/
- Alertmanager：https://prometheus.io/docs/alerting/latest/alertmanager/
