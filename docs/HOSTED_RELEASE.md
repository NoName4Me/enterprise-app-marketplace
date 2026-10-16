# 托管应用：从 GitHub 到测试与生产的受控发布

这是一条**需要先完成管理员接入，然后普通负责人才能直接操作**的发布链路。由 Temporal 编排，GitHub Actions/GHCR 构建，GitOps PR 人工批准，Argo CD 负责 Kubernetes 实际部署；不会重装现有 Mac mini。

## 用户操作

1. 在应用平台创建「GitHub 托管」应用，只填写 `owner/repo`、名称和介绍。TEST、PRODUCTION、内部资产和两套端口由平台自动登记。
2. 打开应用 → 发布 → **部署到测试**。系统派发该仓库 `.github/workflows/marketplace-build.yml`，无需填写 Run ID、镜像或 NodePort。
3. 构建成功后，GitHub 记录与应用 UUID、Source SHA、Run ID 绑定的不可变 GHCR 镜像 Digest。Temporal 据此在**平台仓库**创建 GitOps PR。由具有平台审核权限的人在 GitHub 审核并合并 PR。
4. PR 合并后，Temporal 向 Argo CD 注册当前应用/环境的 Application，等待 `Synced`、`Healthy`、镜像 Digest 匹配，并从 Worker 所在网络探测固定 IP:NodePort HTTP。成功才记录 READY、时间和 Digest。
5. 测试通过后，只有具有 `P4_DEPLOY_OPERATOR_IDS` 生产操作权限的**该应用负责人**可以点「发布到生产」。生产只复用已验证的测试 Digest，不能从分支直接重新构建，仍需独立 GitOps PR 人审。
6. 发布失败或远端写入结果不明，保留记录并停止盲重试。对于不确定的 GitHub POST，先检查 Actions/分支/PR/Argo 后再处理。

## 一次性接入：源仓库管理员

将本仓库的 [`templates/github/marketplace-build.yml`](../templates/github/marketplace-build.yml) 放进目标应用源仓库的 `.github/workflows/marketplace-build.yml`（默认分支 `master`），保证源仓库根目录有可构建的 `Dockerfile`。发布前必须有当前 `master` HEAD 对应的 `.github/workflows/ci.yml` 成功 push 完整 CI；模板在发布 GHCR 前再次核对该 SHA 与 CI 记录，不接受无验证分支或历史 master。源仓库现有 CI 只自动验证，镜像发布须手动触发。该工作流只运行于 GitHub 托管 ARM64 Runner，拥有源仓库 `contents:read / actions:read / packages:write / deployments:write`，不接触 Mac 或 Kubernetes Secret。需要仓库能使用 GH Actions 和 GHCR。如果源仓库没有接入，平台会明确拒绝自动构建。

**容器约定**：当前模板默认容器监听 `8080`，且访问根路径 `/` 会返回 HTTP 2xx；不满足此约定的仓库还需要平台侧配置入口端口/探测路径的后续支持。模板产出的 GHCR 包需允许本机 Kubernetes 拉取。首版建议使用可匿名拉取的 GHCR 镜像；私有包必须由管理员先在相应应用命名空间配置 `imagePullSecret` 或受控镜像凭据同步机制，不要把 GHCR PAT 写入 GitOps。

## 一次性接入：平台管理员

- 核对本机 PostgreSQL `market` 备份，**增量执行** `0011_hosted_releases` 迁移；原数据库、Kubernetes、Temporal、Argo 都不重装，禁止清除 `market_pg`。
- 由管理员把可构建的仓库加入门户 Secret `HOSTED_ALLOWED_REPOS=owner/repo,...`。应用负责人自己填写的仓库不会自动取得构建权限。
- 门户原 `portal-runtime` Secret 还需 `HOSTED_PUBLIC_IP=<稳定且从 Worker 能访问的内网 IPv4>`，`P4_DEPLOY_OPERATOR_IDS=<实际用户ID>`。前者只用于实际 READY 访问链接，不表示已开放 LAN 端口。
- Temporal Worker 使用 `portal-worker-runtime` Secret，新增 `DATABASE_URL=<现有 market 的 Kubernetes 可达地址>`、`HOSTED_GITHUB_SOURCE_TOKEN`（源仓库 Actions 读写、内容/Deployment 只读）、`HOSTED_GITOPS_TOKEN`（**仅平台 GitOps 仓库** Contents + PR 写）、`HOSTED_ARGO_APPLICATION_TOKEN`（**只允许受限 project** `marketplace-hosted` 的 Applications create/get）、`ARGOCD_SERVER_URL` 及相同 `HOSTED_PUBLIC_IP`。生产密钥严格分离，不放源仓库 Actions，也不通过浏览器传给用户。
- Argo CD 管理员安装本仓库的 `p4/gitops/hosted/project.yaml`。确保当前平台 repo 的 `dev` 允许受控 GitOps PR、合并受分支保护/必需 CI 和批准人限制；平台默认不会替人批准 PR。
- 使用本机代理时，Node Worker 需显式配置 `NODE_USE_ENV_PROXY=1`、`HTTP_PROXY`、`HTTPS_PROXY`，并通过 `NO_PROXY` 排除集群 Service DNS 与实际的 `HOSTED_PUBLIC_IP`（显式列出 IP，不只填写 CIDR）；仅设置系统代理不会保证 Node fetch 能访问 GitHub。此配置要求支持该开关的 Node 22 版本。
- Worker 使用新 Dockerfile 构建 ARM64 镜像并滚动替换 `portal-temporal-worker`。检查其可访问 GitHub REST、现有 PostgreSQL、Argo ClusterIP 和固定 NodePort。

```sh
# 这些是增量校验（请本地 Agent 先核对上下文，不要盲改生产）
kubectl get nodes
kubectl -n marketplace get deployment portal-temporal-worker marketplace-portal
kubectl -n marketplace get secret portal-worker-runtime portal-runtime
kubectl -n argocd get appproject marketplace-hosted
kubectl get svc -A -o wide
```

## 发布的技术与安全边界

- GitHub 构建 Workflow 必须返回与应用 ID、源码 SHA、Run ID 一一对应的**唯一** GHCR Digest；不能使用 `latest` 或无审核镜像。
- GitOps 变更只创建 PR，不直接操纵业务 Pod；Argo Application 只在 PR 合并后注册。
- Argo 返回 `Synced` **不等于**真实服务通过，必须再确认 `Healthy`，读取实际 Deployment 核对 Digest、generation 和就绪副本，读取 Service 核对归属与 NodePort，最后验证 HTTP。Argo 3.5 的 `status.summary.images` 可能为空，不能依赖该可选摘要，也不能用上一次同步的镜像记录代替实际资源。
- 后端 ledger `hosted_releases` 与 Temporal 执行历史分开持久化；远端创建分支/PR 超时会停在 `NEEDS_RECONCILIATION`，不允许自动二次派发。
- 同环境一次只允许一条未决发布；升级过程中保留旧 READY 的镜像和访问入口，直到新镜像验证成功。
- 目前自动 HTTP 检查从**Worker 所在网络**发起；它不能代替从员工的 LAN 客户端测试。发布在真实 Mac mini 上仍需验证 OrbStack NodePort 映射及入站防火墙。

## P5 需求交付 → P4 TEST 的受控衔接

- 在需求详情启动 P5 Temporal 任务，负责人审核实施方案；Coding Agent 的 PR 合并至源仓库 `dev` 后，由平台验证 PR 的 `Portal-Requirement-ID`、合并 SHA 和该 SHA 的 GitHub Checks。仅核验成功会显示「部署此需求到 TEST」。
- **源仓库管理员必须人工将包含该提交的 `dev` 历史晋级到 `master`，并通过该仓库 `master` 的完整 push CI。** 平台不会合并 PR、修改分支或绕过审核。源仓库若将 dev squash/cherry-pick 到 master，Git 祖先关系丢失，平台将拒绝此次自动衔接；可走独立 P4 测试发布并人工核对，不伪造需求关联证明。
- 点击需求页「部署此需求到 TEST」后，后端重查当前 owner、唯一受信仓库、Temporal 已验证的 PR SHA；仅通过服务端参数创建带 `requirement_id` 的发布账本。Worker 在任何远端构建 POST 之前，对 GitHub 当前 `master` HEAD 做 compare 祖先核验。构建模板还会要求该 HEAD 的成功完整 CI 与原 SHA 一致，镜像始终按不可变 Digest 经独立 GitOps PR 审核部署。
- 需求页显示同一需求关联的 TEST 发布记录和 GitOps 审核链接。发布进入 READY 后也**不自动生产晋级**。P5 已在旧版运行并缺少已核验合并 SHA 的历史任务不得自动升级到此流程，需从应用发布页手工操作。
- 本改动需要在**现有 market 备份与隔离库校验通过后**仅增量执行 `0012_delivery_release_link`；不要重建 PostgreSQL、Temporal、Argo 或任何现有卷。**先升级 Temporal Activity Worker 并确认 Ready，再升级 Portal**。需求 TEST 发布使用新版 `verifiedHostedReleaseWorkflow`；旧 Worker 不认识该类型时只能等待，不能作为旧版无祖先校验的发布任务运行。仍需谨慎处理尚在运行的老版本工作流历史。

## 尚未完成与验收状态

**2026-10-16 已在 Mac mini 完成首个真实托管仓库的 TEST 链路**：门户 → Temporal → master 完整 CI 校验 → 手动 Actions/GHCR ARM64 → 人工合并 GitOps PR → Argo Synced/Healthy → 实际 Deployment Digest 与就绪副本 → Service NodePort → Worker、Mac 与 Chrome 访问 → 账本 READY；Chrome 的任务新增与完成也已验证。兼容性修复与执行证据记录在 PR #27/#28，不把此次单实例测试视为生产验收。

生产晋级/历史版本回退、独立第二台局域网客户端、私有 GHCR 凭据拉取及应用发布后的整机重启恢复仍为 `NOT RUN`。本轮临时授权只覆盖 TEST；再次发布前须由管理员配置正式受限凭据。
仍需后续支持自动为任意仓库建立标准构建工作流（当前是一次性管理员接入）、私有 GHCR Pull Secret 自动同步、非 8080 端口与不同业务健康端点、监控/AI 事件自动反馈。

## 生产版本选择与安全回退（本轮）

生产发布页会列出**历史上经过 TEST READY 验证**的镜像 Digest。应用负责人选择某一测试记录，然后由具有 `P4_DEPLOY_OPERATOR_IDS` 权限的负责人操作；服务端仅接受测试发布记录 UUID，不接受客户端直接填镜像 Digest。Temporal 与发布账本进一步核验源应用、测试环境状态和镜像真实性。由此可把一个曾经验证通过的旧版本作为回退目标，但回退本身仍要经过新的 GitOps PR 审核与 Argo/NodePort 健康检查。

**注意**：这一能力是“以旧 Digest 发起新的生产发布”，不是绕过 GitOps 的即时回滚。发布工作台的 READY 指工作节点已验证，并不代替员工网络实际访问；若构建过的镜像已从 GHCR 删除、鉴权失效或业务依赖不兼容，发布会停留在待核对状态。

