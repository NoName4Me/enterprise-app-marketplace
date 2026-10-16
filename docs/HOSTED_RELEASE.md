# P4：托管应用的构建与发布（原型阶段）

## 唯一发布链

门户注册关联源仓库的 HOSTED 应用 → TEST 填写分支或 Commit、版本号、发布说明 → Temporal 触发 **源仓库** GitHub Actions → 基于固定 Commit SHA 构建 ARM64 Docker 镜像、容器冒烟测试 → GHCR 发布不可变 Digest → Worker 通过 Kubernetes API 更新该应用 TEST namespace 的 Deployment/Service → 校验实际镜像、副本/Pod Ready 与 LAN NodePort HTTP → 发布记录 READY。

PRODUCTION 不重新构建；选择一个 TEST READY 版本（展示版本号和发布说明），复用同一 Digest，由已有 `P4_DEPLOY_OPERATOR_IDS` 限制生产操作。门户自己的代码仓库不会产生业务发布 PR。数据库持久记录版本/源码 SHA/构建 Run/镜像 Digest/状态/说明。

GitHub 仅提供源代码、代码 PR、目前的 Actions/GHCR；需求始终由门户数据库管理，已移除 GitHub Issue 字段。

## 首次安装或切换：在 Mac mini 执行

**现有 Mac mini OrbStack/Kubernetes、Temporal、PostgreSQL、Prometheus、Loki 均不需要重装。** 原型测试版本的数据可清理。不要一键删除整个 `marketplace` 命名空间、Temporal/DB 的 PVC 或其他应用的资源。

1. 停止尚在运行的旧 P4 GitOps TEST/PRODUCTION Workflow；确认没有继续等待的旧发布任务。
2. 对之前由 Argo 管理的 *业务应用* Application（如 `hosted-<app-id>-test`），确认名称、目标 namespace 后，在 Argo CD 中删除该 Application，**明确选择保留 Kubernetes 资源 / 非级联删除**。否则它可能不断恢复旧镜像。也可以人工仅删除这些临时业务测试资源并重新部署。**不要删除门户/Temporal 等平台基础设施的 Argo Application。**
3. 运行 `drizzle-kit migrate` 执行 `0013_release_labels_and_issue_cleanup`：只清除旧的托管发布账本及端口 READY 指针，新增发布标签/说明和删除废弃 Issue、GitOps PR 数据列；保留应用、账号、需求和其他数据。若想全部重建实验数据库，先确认其它表的业务数据可以丢弃，再由本地人员自行执行。
4. 逐环境执行 `bash p4/temporal/provision-hosted-access.sh <app-uuid> <environment-uuid> TEST`（生产为 PRODUCTION），建立 namespace 与受限 Worker RBAC。它不会删除 Deployment、Service、PVC；默认不清理旧应用资源。
5. 部署新 `p4/temporal/worker.yaml`（专用 ServiceAccount），**先确认 Worker 启动且识别新 `hostedReleaseWorkflow`，再部署 Portal**。两者是唯一新工作流，不需要设置 `HOSTED_DEPLOY_DRIVER`。
6. 在源仓库更新 `.github/workflows/marketplace-build.yml`，使用本项目的 `templates/github/marketplace-build.yml` 版本。旧模板强制 master，不能构建任意 Commit。首次仓库接入暂需管理员安装模板。
7. Portal 配置仅有 Actions:read 的 `HOSTED_GITHUB_LOG_TOKEN`，用于步骤/日志查看，避免此前匿名 API 配额限制；Worker 的 `HOSTED_GITHUB_SOURCE_TOKEN` 是另一个具有构建派发权限的令牌。检查 Worker 可访问 GitHub、GHCR、Kubernetes API，`HOSTED_PUBLIC_IP` 是 Mac mini 固定内网 IP。
8. 在门户新建 TEST 发布（建议非默认分支），确认 **没有新的 GitOps PR**，Portal 显示版本号、源码 SHA、构建步骤/日志、健康验证和 READY；再验证 PRODUCTION 选已验证 TEST 镜像。先不宣称生产可用或独立 LAN 客户端已验收。

**注意**：执行 `0013` 只清理 PostgreSQL 中的旧发布记录，不会自动移除 Kubernetes/Argo 的控制器。两者要分别处理。此流程尚待 Mac mini 直发模式真实 E2E 验证，不能把之前 #31 的 GitOps E2E 当作直发验收。

## 「运行」页：默认生产，测试可切换（2026-10-16）

打开托管应用的「运行」Tab 后，门户自动读取 **PRODUCTION** 的当前状态，不需要再按「读取应用状态」。右上角可切换到 **TEST**，读取另一个真实 Kubernetes 命名空间的 Deployment/Service、镜像 Digest、Pod 就绪、副本、NodePort 和 HTTP。显示上一次发布版本号和说明，但 **仅发布记录为 READY 不等于当前运行健康**。刷新按钮用于手工重试或获取最新状态。

没有生产发布时显示「生产环境尚未发布」，并提供「查看测试环境」入口；不会偷偷回退到测试环境，更不会把 TEST 状态标成生产。不可访问 Kubernetes API/缺少 RBAC 时标记状态「暂不可读」，不能报运行正常。外部应用仍使用原有只读监控面板。

首次部署新版门户（只需一次）需要给它绑定 **只读** ServiceAccount；该账号不能部署或修改应用、不能读取 Secret。

1. 在本地对每个 TEST/PRODUCTION 环境重新执行一次 `bash p4/temporal/provision-hosted-access.sh <app-uuid> <env-uuid> TEST` 或 `PRODUCTION`。脚本现在同时给 `portal-hosted-reader` 授予当前环境 Deployment/Service 的 `get` 权限，并给这个账号全局只读 Namespace `get` 以核实应用/环境标签。已存在 Worker、Deployment、Service、数据卷保留。
2. 脚本先创建好 SA 后，更新 **实际运行的门户 Deployment** 使用 `portal-hosted-reader`：`kubectl -n marketplace patch deployment marketplace-portal --type=merge -p '{"spec":{"template":{"spec":{"serviceAccountName":"portal-hosted-reader"}}}}'`。不需要重新安装基础设施，也不应该误覆盖当前容器镜像。
3. 升级门户镜像，打开应用 `?view=operations`，验证初次展示生产环境（未部署时显示空状态），再切到 TEST，确认镜像和 READY 与真实 `kubectl -n <namespace> get deploy web` 匹配；尝试未授权读取应返回 401/404。

**PRODUCTION 与第二台 LAN 客户端尚未实机验收。** 后续测试时：在门户从 TEST 的 `v1.1.0-e2e` 选择原 Digest 发布 PRODUCTION（不重新 Actions 构建）、实际确认生产与测试 namespace 和 NodePort 相互独立，然后在第二台同网段设备直接访问生产和测试端口。未经这些验证，不在报告里写 PASS。
