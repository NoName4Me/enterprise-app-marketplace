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


## 发布页执行详情（新增，待实机验收）

- 「应用 → 发布 → 发布执行记录」可以展开一条发布的执行流程：构建、GitOps 审核、部署、健康检查。状态来自现有发布账本及 Temporal 查询；只有应用负责人可以查看。
- 构建进行时每约 8 秒查询源仓库 GitHub Actions 作业和步骤，按需从 GitHub 下载指定作业的原始日志；**实时的是步骤状态**，GitHub 下载接口可能在作业执行中尚不提供最新文本，不得宣称逐行实时日志已经实现。
- 门户服务端可选设置 `HOSTED_GITHUB_LOG_TOKEN`（Fine-grained token：仅已接入源仓库的 Actions:read）。**不得使用具有 Actions 写权限的 Worker 构建凭据替代**；不要把令牌返回浏览器。公开仓库可尝试无令牌读取；私有仓库须配置此只读令牌。GitHub API 不可达时页面显示不可读取，而不把发布判为成功或失败。
- 日志下载只允许当前应用、当前发布、当前构建 Run 中的真实 Job ID；仅跟随已校验的 GitHub 日志短期签名地址，不携带服务器令牌到下载 CDN；每次最多下载 4 MiB 并只展示末尾约 128 KiB；更大日志需进入 GitHub 查看原文。不要把业务密钥写入 Actions 日志。
- 只需更新既有 Portal 镜像及其受限 Secret；**不需要新增数据库迁移、重装 Kubernetes/Temporal/Argo、清理卷**。升级前检查实际部署与 PR #29 的相容性。
- 实机待验证：私有/公开仓库日志读取、构建步骤刷新、日志上限与权限拒绝、源仓库网络代理、Mac mini 现有发布流程及 GitOps 审核。
- 此轮没有启用自动审核 GitOps PR，也没有实现自动为任意仓库写入 CI 模板。测试发布自动审批应另设受约束策略，而不是取消现有 GitOps 来源校验。

> 需求、审批、讨论、状态和结果以门户需求中心为准；GitHub 仅作为代码/PR 及当前 Actions 构建端，不要求创建 GitHub Issue。

## 下一阶段（开发中）：TEST 版本标签与源码选择

- 用户为 TEST 指定任意分支或完整 Commit SHA（仅在该应用已登记的仓库中解析），填写 **版本号、发布说明**；空分支代表仓库默认分支，Worker 在发布前固定为完整 SHA，构建模板 checkout 确切 SHA。
- 新版模板将取消必须是 master HEAD 的限制，仍要求 Dockerfile、构建/容器冒烟测试以及与实际构建 Run 匹配的不可变 GHCR digest。**源仓库必须更新模板**，否则仍会因旧模板的 master 检查而失败；此 PR 不自动覆盖用户仓库工作流。
- PRODUCTION 只能选择历史 TEST READY，界面优先显示版本号与说明，部署继续复用相同 digest，不允许选择外部不明镜像。
- 门户构建日志必须配置 `HOSTED_GITHUB_LOG_TOKEN`（只读 Actions 权限），避免匿名 GitHub REST API 配额失败。缺少令牌时直接给出配置提示，不持续发起匿名轮询。
- 增量 migration `0013_release_labels_and_issue_cleanup`：只增加发布元数据列并删除已废弃的 `requirements.github_issue_url`；**不删除需求、讨论、应用与历史发布记录**。源表升级前备份并验证。产品不再使用 GitHub Issues 管理需求。
- **注意：当前这批代码尚未取消 GitOps PR！** 直接 Kubernetes 发布和原 Argo Application 安全移交是下一个独立切片，未完成前继续遵守旧发布链路，不得同时由 Argo 和门户修改相同 Deployment。

## P4 新直接部署模式（实验性，需实机验收）

**此节覆盖上文旧 GitOps TEST/PRODUCTION 流程的对应说明。** 旧模式仍为默认值，已经完成 2026-10-16 Mac mini E2E 验收。新模式目前仅完成代码和 CI 候选实现，Mac mini **NOT RUN**。

新发布链：门户选择源码分支/Commit + 版本号 + 发布说明 → GitHub Actions/GHCR → Temporal Worker 在**对应已登记的应用/环境 namespace** 更新 Kubernetes Deployment/Service → 核对实际 Pod 镜像 Digest、就绪、副本及 NodePort HTTP → READY。不再为每次业务发布创建本平台的 GitOps PR。PRODUCTION 只复用历史 TEST READY 的 Digest，且继续使用既有 `P4_DEPLOY_OPERATOR_IDS` 授权。

**上线和接管步骤（管理员逐环境执行）**：

1. 先备份现有 `market`，在隔离库验证并增量执行 `0013_release_labels_and_issue_cleanup`。它保留历史发布、需求和版本数据，增加 `deploy_driver/source_ref/version_label/release_notes`，删除不再使用的 `requirements.github_issue_url`；禁止清空卷或重建集群。
2. 在 Mac mini 先确认旧的 Argo Application 及其关联的资源归属。每个环境的命名空间为 `hosted-<应用 UUID 去掉连字符>-test` 或 `-production`。保留命名空间、Deployment、Service、PVC 和已有服务。**新模式的 Worker 会拒绝操作仍被旧 Argo Application 管理的环境**。
3. 在核实 Application 的 Project、source.path 和目标 namespace 是预期业务环境、且确认非平台自身服务后，由管理员对该**具体应用环境**取消 Argo Application 的资源删除 finalizer，再删除其 Application CR；不能使用默认级联删除来移除托管的业务对象。先确认删除后 Pod 和 Service 仍存在，且没有别的 GitOps controller 再同步。该动作需管理员人工核对，不由 Portal 自动删除。
4. 初始化每个业务环境的最小权限部署通道：执行 `bash p4/temporal/provision-hosted-access.sh <app-uuid> <env-uuid> TEST`（生产环境将 TEST 换成 PRODUCTION）。该脚本仅创建/验证 namespace 标签，并在该 namespace 建立 ServiceAccount `marketplace:portal-hosted-worker` 专用的 Deployment/Service get/create/patch RoleBinding；Namespace get 为集群范围只读授权。它**不会**删除旧业务资源、改镜像、安装 Argo 或删除旧卷。新创建的应用在首次发布前也需要相同初始化，后续再做受控自动 bootstrap。
5. 应用新版 `p4/temporal/worker.yaml`（新增 `portal-hosted-worker` ServiceAccount，先创建再滚动 Worker），检查 ServiceAccount token/CA 挂载、Kubernetes API、Argo 只读检查和目标 namespace 的操作权限。先升级 Worker，确认可处理 `directHostedReleaseWorkflow`，再升级 Portal。
6. 仅在门户 `portal-runtime` Secret 设置 `HOSTED_DEPLOY_DRIVER=kubernetes`，并滚动更新门户；Worker 使用自身集群权限执行 Activity，不需要额外安装 Docker 或把 kubeconfig 暴露给浏览器。生产授权、镜像 Digest、发布账本与 Temporal 旧任务仍保留。**不要在仍有旧 GitOps release 正在等待 PR 或部署时切换。**
7. 使用 TEST 发布一个新版本做 Mac mini 实验验证；同时检查命名空间、Deployment、Pod、Service、Pod logs、Temporal 快照与门户 READY，以及第二个局域网客户端。PRODUCTION/回滚需另做验收。

回退 `HOSTED_DEPLOY_DRIVER` 不会自动重新创建此前被移除的 Argo Application；已经移交的环境要重新使用旧 GitOps 模式，必须先由管理员按原 GitOps 仓库目标状态重新受控注册/核对 Argo Application，**绝不可让两个管理器同时修改 Deployment**。正在运行的旧 Temporal GitOps Workflow 不改写，新 Workflow 通过独立类型避免执行历史回放不兼容。

**构建模板同步**：平台新 `templates/github/marketplace-build.yml` 支持任意仓库内的 Commit SHA；已经安装旧模板的源码仓库必须更新模板并通过相应代码审核，否则旧模板仍会要求 `master`。此阶段暂未实现门户代用户自动安装 Workflow。

**日志配额**：门户 `HOSTED_GITHUB_LOG_TOKEN` 为仅 Actions:read 的独立服务端 Token，未配置则返回显式错误，不消耗匿名 GitHub API 配额；这是本地日志观察能力的接入要求，和 Worker 的 `HOSTED_GITHUB_SOURCE_TOKEN` 分开。
