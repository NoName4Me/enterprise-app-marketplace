# P4 临时 Mac mini 本地执行指南

> 本文件是待用户在单台 Mac mini M4 / 16GB / OrbStack 上运行的临时指引，尚未实测。保留已有 Docker Compose/PostgreSQL 及卷，禁止运行 orb delete k8s、docker volume prune、down -v、重置数据库。

## 方案与资源

直接使用 **OrbStack 自带 Kubernetes 单节点**，无需额外 Linux VM 或第二套 k3s。官方：https://docs.orbstack.dev/kubernetes/ 。

完整链路：GitHub master CI → GitHub Actions lab-publish → GHCR 的 ARM64 Digest → GitOps PR(dev) → Argo CD → Argo Rollouts 蓝绿预览 → 手动 promote → Traefik active Service。监控由 Prometheus / Loki / Alloy 提供，门户按应用访问权限读取状态/证据。

建议先从 OrbStack 可用内存 9–11GB 开始，具体按本机实际内存使用调整。不要当作企业生产集群。

## 1. 启用本机 Kubernetes

    orb start k8s
    kubectl config current-context
    kubectl get nodes -o wide
    brew install helm argocd
    brew install argoproj/tap/kubectl-argo-rollouts

**必须确认 kubectl 的当前 context 是 OrbStack**，避免误操作其他集群。

## 2. 安装 Argo、Rollouts 和 Traefik

    kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
    kubectl apply -n argocd --server-side --force-conflicts -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
    kubectl create namespace argo-rollouts --dry-run=client -o yaml | kubectl apply -f -
    kubectl apply -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
    helm repo add traefik https://traefik.github.io/charts
    helm repo update
    helm upgrade --install traefik traefik/traefik -n traefik --create-namespace --set service.type=LoadBalancer
    kubectl -n argocd rollout status deployment/argocd-server --timeout=240s
    kubectl -n argo-rollouts rollout status deployment/argo-rollouts --timeout=240s

此处使用官方 stable/latest 方便首次演示。实测成功后再记录版本并固定，避免以后升级导致变更。

本机访问 Argo CD（单独终端保持端口转发）：

    argocd admin initial-password -n argocd
    # API/界面本机访问按第 9 节配置 HTTP + loopback 端口转发（避免自签名证书问题）

完成第 9 节后浏览 http://127.0.0.1:8088 。门户使用只读专用 Argo CD token；不要把管理员密码提交到 GitHub，也不要关闭 Node 的 TLS 证书校验。

## 3. 在门户里绑定实验应用

新建或选择一个**自己负责的测试应用**，在私有资产页登记组件 web、环境 test，记录应用 UUID 和环境 UUID。生成 Argo CD bootstrap YAML：

    node scripts/p4-bootstrap.mjs <应用UUID> <环境UUID> > /tmp/p4-argocd.yaml
    kubectl apply -f /tmp/p4-argocd.yaml
    kubectl -n argocd get applications

脚本将 Application 的 metadata.labels 写成 marketplace-app-id / marketplace-environment-id，门户借此读取真实 Argo 状态。GitOps 源为仓库 dev 分支的 p4/gitops/lab。首次镜像 Digest 为无效全零占位，必须先完成真实发布 PR。

## 4. 可信镜像 → GitOps PR

沿用原有实验工作流：先在 GitHub Actions 中确认 master 的完整成功 CI Run ID，然后手动运行 lab-publish.yml 生成可信 ARM64 镜像与 lab-release artifact。

获取成功的发布 Run ID，手动运行 P4 - Open GitOps promotion PR（输入发布 Run ID + healthy），或者在本机有 gh 登录的干净 dev 仓库运行：

    GH_TOKEN="$(gh auth token)" node scripts/p4-open-promotion.mjs <发布RunID> healthy

仅更新 GitOps Rollout 的不可变镜像 Digest，不涉及 Mac 的 Docker Socket，也不直接修改 Kubernetes。若 Actions 创建 PR 被仓库设置禁止，脚本会保留已推送分支，再手动对 dev 发 PR。工作流必须先合入默认分支 master 才能从 Actions 页面手动启动。PR 合并到 dev 后 Argo CD 自动拉取和调谐。

如果 GHCR package 非公开，需要在 marketplace-lab namespace 安装对应的 imagePullSecret；为了快速跑通实验，可将实验镜像 package 设置为 Public。

## 5. 蓝绿部署、切流与回滚

    kubectl -n marketplace-lab get rollout,pod,svc,ingress
    kubectl argo rollouts get rollout marketplace-lab -n marketplace-lab --watch
    kubectl argo rollouts promote marketplace-lab -n marketplace-lab
    kubectl argo rollouts status marketplace-lab -n marketplace-lab
    curl -fsS http://lab.k8s.orb.local/health
    curl -fsS http://lab.k8s.orb.local/version

Rollouts 的 active Service 控制流量，autoPromotionEnabled=false 表示需要主动 promote。Healthy / Synced 不应被直接解释为“流量已切换”。

故障验证：第二次发布可选择 unhealthy Digest，readinessProbe 应阻止不健康版本进入 active。回滚应通过 GitOps PR 将镜像 Digest 恢复为上一个可信值，再由 Argo 同步/人工 promote。仅用 kubectl undo 而不修改 GitOps 声明会遭到自动同步覆盖。

## 6. 可观测性安装

    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm repo add grafana-community https://grafana-community.github.io/helm-charts
    helm repo add grafana https://grafana.github.io/helm-charts
    helm repo update
    helm upgrade --install monitor prometheus-community/kube-prometheus-stack -n monitoring --create-namespace --set alertmanager.enabled=false --set prometheus.prometheusSpec.retention=2d
    helm upgrade --install loki grafana-community/loki -n monitoring -f p4/observability/loki-values.yaml
    helm upgrade --install alloy grafana/alloy -n monitoring -f p4/observability/alloy-values.yaml
    kubectl -n monitoring get pods
    kubectl apply -f p4/observability/lab-service-monitor.yaml
    kubectl apply -f p4/observability/lab-alert-rule.yaml
    kubectl -n monitoring get servicemonitor marketplace-lab

Loki 使用单体、短期保留和本地文件存储，非高可用。Grafana Loki 官方说明：https://grafana.com/docs/loki/latest/setup/install/helm/install-monolithic/ 。社区 Helm chart 可能变化；若报 values/schema 错误，先用 helm show values 核对，不要强制删除现有 PVC。

本地按需端口转发供门户读取：

    kubectl -n monitoring port-forward svc/monitor-kube-prometheus-stack-prometheus 9090:9090
    kubectl -n monitoring port-forward svc/loki-gateway 3100:80

## 7. 门户环境变量（只配服务端）

    ARGOCD_SERVER_URL=http://127.0.0.1:8088
    ARGOCD_READ_TOKEN=<只读令牌>
    ARGOCD_ALLOWED_PROJECTS=marketplace-lab
    PROMETHEUS_SERVER_URL=http://127.0.0.1:9090
    LOKI_SERVER_URL=http://127.0.0.1:3100
    DEEPSEEK_API_KEY=<服务端密钥>
    AIOPS_LLM_BASE_URL=https://api.deepseek.com
    AIOPS_LLM_MODEL=deepseek-flash
    AIOPS_LLM_SEND_LOGS=false

注意：如果 Next.js 在 Docker 容器里运行，localhost 指向容器自身，不能直接照抄 Mac 的 localhost。Argo 自签名 HTTPS 需要受信证书/代理，严禁 NODE_TLS_REJECT_UNAUTHORIZED=0。

## 8. 验收清单（未运行）

- [ ] 内置 Kubernetes / Argo / Traefik / Prometheus / Loki / Alloy 可用
- [ ] 可信 GHCR Digest 经 GitOps PR 合并，Argo Synced
- [ ] 首次健康版本服务访问 OK，版本来源与预期 SHA 一致
- [ ] 第二版只在 preview，手动 promote 后 active 改变
- [ ] 不健康版被阻断，旧版仍可用；GitOps 回退演练可恢复
- [ ] 门户登录权限生效，读取真实 Argo/Prometheus/Loki 来源和时间
- [ ] AI 只读诊断给出证据，不执行写操作

> 实机未运行时这些项都为 NOT RUN；不得说 P4 生产发布完成。

## 9. 让本机 Argo CD API 可以被门户安全地读取

本地 Port Forward 默认连接 Argo 的 HTTPS 自签名证书，会被 Node.js 正常拒绝。仅在**本机实验**将 Argo server 设置为明文 HTTP，然后只绑定 loopback 的端口转发（不要打开公网服务）：

    kubectl -n argocd patch cm argocd-cmd-params-cm --type merge -p '{"data":{"server.insecure":"true"}}'
    kubectl -n argocd rollout restart deployment/argocd-server
    kubectl -n argocd rollout status deployment/argocd-server
    kubectl -n argocd port-forward --address 127.0.0.1 svc/argocd-server 8088:80

门户配置 ARGOCD_SERVER_URL=http://127.0.0.1:8088，使用只读专用 Token。若门户在 Docker 内，请配置对应的明确可达入口而不是容器 localhost；不要禁用 TLS 验证。

发布操作入口另外需要 P4_DEPLOY_OPERATOR_IDS（当前用户 ID 白名单）和 P4_GITHUB_DISPATCH_TOKEN（仅限仓库 Actions workflow dispatch 的服务端 GitHub Token）。操作者仍需拥有该应用的创建权限、应用 owner 身份，且应用有 TEST 环境。触发仅表示 GitHub 接受请求，不等于成功发布。

## 10. AI 诊断的可观测性证据

样例应用增加 /metrics（Prometheus exposition）、/health、/version 和结构化健康日志。ServiceMonitor 只抓取 active Service 的流量后端；配合单机 Kubernetes 的 kube-state-metrics、Alloy→Loki，可以在门户看到 active 实例健康、namespace Pod 就绪/重启次数以及最近日志。如果 Prometheus 的监控标签/CRD 未正确启用，页面显示 UNKNOWN，而不会伪装数据。

首次配置 Argo CD 只读 API Token 时，请先创建单独账号并在新安装的 Argo CD 上设置只读 RBAC（避免使用 admin token）。例如：

    kubectl -n argocd patch cm argocd-cm --type merge -p \'{"data":{"accounts.portal":"apiKey"}}\'

再为账号 portal 配置 marketplace-lab/* 范围的 applications,get RBAC，并使用 argocd account generate-token --account portal 获取 Token。不要覆盖已有的 argocd-rbac-cm.policy.csv；应追加一条角色策略和账号映射。查询失败通常是 Token 权限不足、服务端无法连通或 Argo Application 标签/Project 映射不一致。

目前 AI 只读诊断要求云端大模型 API（/api/chat 协议）及 AIOPS_MODEL。未安装模型时按钮显示 NOT_CONNECTED；模型分析只是建议，不能当成已完成自动修复。

## 11. 生效版本判定

Argo CD 的 desiredRevision 和 history.revision 表示 **GitOps 声明/同步历史**，不能直接当成 active 流量版本。P4 Lab ServiceMonitor 抓取 Rollouts active Service 的 /metrics 中 marketplace_lab_info{revision=...}；门户会在这个时间序列**恰好只有一条**时显示其观测 SHA。多条或无样本则显示未知，绝不据此声称发布完成。正式验收仍需用入口 /version 直接核对。

## 12. 从门户通过 Argo CD 内置动作切流

Argo CD 内建 Rollout 资源动作 promote-full、abort；门户测试环境内的“确认切流”/“中止发布”按钮调用官方 Argo CD API，不自己修改 Service selector。需另建 **ARGOCD_ACTION_TOKEN**，不要复用只读 Token。RBAC 仅允许 marketplace-lab/* 的 applications,get 与对应 action/argoproj.io/Rollout/promote-full、action/argoproj.io/Rollout/abort，禁止笼统允许 action/*。操作人还需在 P4_DEPLOY_OPERATOR_IDS 内、为应用 owner、存在 Argo app/environment UUID 的匹配绑定。

本 API 接受 action 请求不是实际生效结果。按钮操作后须重新读取门户运行状态，并用 curl http://lab.k8s.orb.local/version 核查 active 代码版本；生产动作不开放。官方参考：https://argo-cd.readthedocs.io/en/latest/operator-manual/resource_actions/ 。

## 13. 告警验收

门户只读取 Prometheus /api/v1/alerts，并严格筛选专用 marketplace-lab namespace 的 alert，不替代 Alertmanager。示例 PrometheusRule 在 active 实例持续 30 秒报告 marketplace_lab_health==0 时告警；不健康预览版通常不会进入 active Service，所以应以 Argo Rollout 的异常和 ready 状态验证其被阻断。告警 API 暂时不可达显示 UNKNOWN，而不是无告警。

## 云端模型信息边界

P4 不安装 Ollama。DeepSeek 默认使用 https://api.deepseek.com/chat/completions；也可用任意受信、兼容 OpenAI Chat Completions 的 HTTPS 服务商 URL 配置 AIOPS_LLM_BASE_URL（不用填 /chat/completions 后缀）。仅服务器端读取密钥，默认只发送 Argo/GitHub 概要、Prometheus 指标和告警；原始 Loki 日志**默认不发送**，避免员工数据及 Token 外流。按需显式启用 AIOPS_LLM_SEND_LOGS=true 前先检查脱敏策略。

## P3/P5 与单机联调关系

P3 需求中心使用门户 PostgreSQL，必须在**隔离测试库验证**新迁移 0008 后再对 Mac 上已存在数据的数据库按既有流程增量迁移（不可清空卷）。P5 不需要在 Mac 上安装 Coding Agent，GitHub 服务器端运行 Copilot Cloud Agent；只需本地服务端 `.env` 配置 `P5_COPILOT_USER_TOKEN`、`P5_ALLOWED_REPOS`，仓库需具备 Copilot 付费资格并启用该能力。未开通时返回 NOT_CONNECTED/配置缺失，不会假装 Agent 已运行。DeepSeek 等云端模型 API 不依赖本机 GPU/Ollama。

## Temporal 长期交付工作流

Temporal 的 Mac 实验指引见 [TEMP_TEMPORAL_MAC_SETUP.md](TEMP_TEMPORAL_MAC_SETUP.md)；原有 GitHub CI / Argo CD / Rollouts 仍保留各自职责，不在门户重写发布状态机。
