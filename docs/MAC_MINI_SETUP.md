# Mac mini 统一服务器部署与验收（OrbStack Kubernetes）

> **唯一主入口**。目标硬件：**一台 Mac mini M4 / 16GB**，已安装 OrbStack。**仅编写配置和操作步骤，未在用户 Mac 实测（NOT RUN）**。任何出现错误的步骤先停止并排查，不要重置/清空现有数据库或卷。关联：`p4/temporal/`、`p4/platform/`、`p4/gitops/lab/`、`p4/observability/`。

## 0. 整体结构、取舍和边界

- **macOS** 只负责 OrbStack 管理及 `kubectl`、`helm`、`docker` 命令；不作为 Temporal Server / Worker 的常驻运行环境。
- **OrbStack 内置单节点 Kubernetes** 承载门户 Next.js、Temporal Server/UI、独立的门户 Temporal Activity Worker、Argo CD、Rollouts、Traefik、演示应用、Prometheus 和可选 Loki。**不再创建 Linux VM / 不再安装第二套 k3s**。
- **已有 Compose PostgreSQL** 暂时保留（`compose.yaml` 的 `market_pg` 卷，当前端口仅绑定 `127.0.0.1:5432`）。不是另起第二套 PG，也不为了统一而迁入 Kubernetes。Temporal 在同一个 PG 实例使用 **temporal** 和 **temporal_visibility** 两个独立数据库和账号；原有 **market** 保持原样。
- **GitHub Actions / GHCR** 仍承担可信构建；**Argo CD / Rollouts** 负责实际 GitOps 调谐和切流；**Temporal** 才负责跨系统等待、审批、可恢复长任务。P3 普通 CRUD 与 P4 只读查询不需要每次触发 Workflow。
- DeepSeek 等 LLM 和可选 GitHub Copilot Cloud Agent 在云端，不在 Mac 部署模型。不要把 Agent PR 挂到拥有 Mac 管理权限的 self-hosted Runner。

组件作用与部署位置：

| 组件 | 运行位置 | 持久化 |
| --- | --- | --- |
| Mac / OrbStack | macOS | macOS 磁盘 |
| PostgreSQL 16 | 现有 OrbStack Docker Compose | **原卷 market_pg，严禁删除** |
| Next.js 门户 | Kubernetes `marketplace` namespace | 现有 PG 数据库 `market` |
| Temporal Server 1.32、Web UI | Kubernetes `temporal` namespace | 同一 PG 实例的 `temporal` + `temporal_visibility` |
| Temporal Activity Worker | Kubernetes `marketplace` namespace | 无自身数据库，历史由 Temporal Server 维护 |
| Argo / Rollouts / 演示服务 | Kubernetes | GitOps 和 k8s 状态 |
| Prometheus / Loki | Kubernetes | 临时保留策略/可选持久卷 |

**重要**：Kubernetes 的 `localhost` 只指向当前 Pod。现有 Compose 端口绑定 Mac loopback，`host.docker.internal` 是需要**从 Kubernetes Pod 实测**的候选访问地址，不应被当作已验证事实。若访问失败，先确定 OrbStack 容器网络/可解析主机名，再改配置；不要直接将数据库端口开放到局域网。

## 1. 检查 OrbStack、资源和既有数据

在 Mac 进入仓库 `dev` 工作树后运行：

```sh
orb start k8s
kubectl config current-context
kubectl get nodes -o wide
docker compose -f compose.yaml ps postgres
docker volume ls | grep market_pg
docker compose -f compose.yaml exec -T postgres pg_isready -U market -d market
kubectl top nodes || true
```

先检查 `kubectl` 当前 Context **确实是 OrbStack**，不要误操作其他集群。**不要执行** `docker compose down -v`、`docker volume prune`、`orb delete k8s`、`pg_dropcluster`、`DROP DATABASE`。建议先备份已有 market 数据库（在 Mac 的受保护目录）：

```sh
mkdir -p "$HOME/marketplace-backups"
docker compose -f compose.yaml exec -T postgres pg_dump -U market -Fc market > "$HOME/marketplace-backups/market-before-p4.dump"
test -s "$HOME/marketplace-backups/market-before-p4.dump"
```

16GB 单机先保持**所有服务单副本**，按 `kubectl top pods -A` 检查占用；Loki、Grafana 可以稍后启动。Node/Temporal/Argo 同时运行若出现 OOM，先调整副本及可选观测组件，不先添加新 VM。

## 2. 在已有 PostgreSQL 上建立 Temporal 的两个库

`p4/temporal/bootstrap-databases.psql` 只创建角色/新库，不修改 `market`，并且不保存密码：

```sh
docker compose -f compose.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U market -d postgres < p4/temporal/bootstrap-databases.psql
docker compose -f compose.yaml exec postgres psql -U market -d postgres
```

在第二条交互式 `psql` 会话中运行：

```text
ALTER ROLE temporal_user LOGIN;
\password temporal_user
\q
```

通过交互式 `\password` 设置密码（不要把明文密码写进命令历史或 Git）。新的两个数据库由 `temporal_user` 拥有，**门户的 Drizzle 迁移只处理 market；Temporal 使用官方 Helm Schema Job 管理自己的 Schema**。

## 3. 验证 Kubernetes Pod 到现有 PostgreSQL 的网络

```sh
kubectl apply -f p4/platform/namespace.yaml
kubectl -n marketplace run pg-probe --rm -i --restart=Never --image=postgres:16-alpine -- \
  pg_isready -h host.docker.internal -p 5432 -U temporal_user -d temporal
```

只有得到 `accepting connections` 才能继续。若失败，先检查 `docker compose ps`、当前端口绑定和 OrbStack DNS；从 **Pod** 确认一个稳定可达的 PostgreSQL 主机名后，同时修改：

1. `p4/temporal/values.yaml` 的 **两个** `connectAddr`；
2. 本地 `.env.portal.k8s` 的 `DATABASE_URL` 主机名。

不要用 Pod 的 `127.0.0.1` 指向 Compose，也不要在未经验证时把 DB 端口改成 `0.0.0.0:5432`。仅 `pg_isready` 还不足以验证用户名密码；后续 Temporal Schema Job 与门户健康接口负责进一步核对授权。

## 4. 安装 Temporal Server/UI：官方 Helm Chart + 外部 PostgreSQL

本仓库配置针对 Temporal Helm Chart **1.7.0**（Server 1.32.0），锁定版本并仅使用 PostgreSQL，不另装 Cassandra/Elasticsearch/SQLite：

```sh
kubectl create namespace temporal --dry-run=client -o yaml | kubectl apply -f -
helm repo add temporal https://go.temporal.io/helm-charts/
helm repo update temporal
helm show chart temporal/temporal --version 1.7.0
helm template temporal temporal/temporal --version 1.7.0 -n temporal -f p4/temporal/values.yaml > /tmp/portal-temporal-rendered.yaml
```

先在 Mac 根目录手动创建 **Git 已忽略** 的 `.env.temporal.pg`（建议 `umask 077`），只含：

```ini
password=<与 psql 中 temporal_user 相同的密码>
```

创建 Kubernetes Secret，绝不提交这份文件：

```sh
kubectl -n temporal create secret generic temporal-db-secret --from-env-file=.env.temporal.pg --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install temporal temporal/temporal --version 1.7.0 -n temporal \
  -f p4/temporal/values.yaml --wait --timeout 15m
kubectl -n temporal get pods,svc,jobs
kubectl -n temporal logs deployment/temporal-frontend --tail=60
```

其中 `values.yaml` 的 `createDatabase: false` 表示不会替你创建/覆盖数据库；`manageSchema: true` 由 **Temporal Helm 的 Schema Job** 初始化并升级 `temporal` / `temporal_visibility`。这两个库必须事先创建，数据库账号需要相应所有权。不要给 `market` 运行 Temporal 的 Schema 初始化。

Temporal 内部 `temporal-worker` 是**服务器自己的系统服务**，而后文的 `portal-temporal-worker` 才是我们的业务 Activity Worker，两者必须区分。Temporal UI 仅在本机端口转发访问，避免未经验证的外部开放：

```sh
kubectl -n temporal port-forward --address 127.0.0.1 svc/temporal-web 8233:8080
# 浏览 http://127.0.0.1:8233
```

若 Helm/chart 服务名称与上述不符，以 `kubectl -n temporal get svc` 的实际结果为准，不要强行假定它已正常运行。

## 5. 构建门户与 Temporal Activity Worker 并部署到 Kubernetes

这里选择**本地构建 ARM64 镜像、仅供实验**。首次验收后，可把两个镜像改为受 GitHub Actions 管理的 GHCR 不可变 Digest。暂不让容器访问 Docker Socket。

```sh
docker build --platform linux/arm64 -t marketplace/portal:dev -f Dockerfile .
docker build --platform linux/arm64 -t marketplace/temporal-worker:dev -f p4/temporal/Dockerfile.worker .
```

请在仓库根目录创建两个 Git 已忽略的**本地配置文件**（不会覆盖或修改你的现有 `.env`）：

`.env.portal.k8s`：从现有 Mac `.env` **复制必要的服务端配置值**，其中 `DATABASE_URL` 改为 Pod 实测可达的 PG 主机名（**不是 localhost**），`BETTER_AUTH_URL=http://portal.k8s.orb.local` 与实际浏览器地址匹配；包含原 `BETTER_AUTH_SECRET`、DeepSeek API 和门户访问外部源所需的 Token。端口使用 `ARGOCD_SERVER_URL=http://argocd-server.argocd.svc.cluster.local`、`PROMETHEUS_SERVER_URL=http://monitor-kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090`、`LOKI_SERVER_URL=http://loki-gateway.monitoring.svc.cluster.local:80`（后两者安装后才可用）。

`.env.worker.k8s`：**只放 Activity Worker 需要的** `DEEPSEEK_API_KEY`（或 `AIOPS_LLM_API_KEY`）、`AIOPS_LLM_BASE_URL`、`AIOPS_LLM_MODEL`、`P5_COPILOT_USER_TOKEN`。不放门户会话 Secret、`DATABASE_URL` 或 Argo 发布凭据。

```sh
kubectl -n marketplace create secret generic portal-runtime --from-env-file=.env.portal.k8s --dry-run=client -o yaml | kubectl apply -f -
kubectl -n marketplace create secret generic portal-worker-runtime --from-env-file=.env.worker.k8s --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f p4/platform/portal.yaml
kubectl apply -f p4/temporal/worker.yaml
kubectl -n marketplace rollout status deployment/marketplace-portal --timeout=240s
kubectl -n marketplace rollout status deployment/portal-temporal-worker --timeout=240s
kubectl -n marketplace logs deployment/portal-temporal-worker --tail=80
# 完成下一节 Traefik 安装后再用 curl 验证入口域名
```

OrbStack 的 Docker 与 Kubernetes 可能复用容器镜像存储，但**必须以本机 Pod 是否能拉取本地镜像为准**。如遇 `ImagePullBackOff`，检查 OrbStack 的 Kubernetes 镜像可见性；改用本机可访问的镜像仓库或 GHCR ARM64 Digest，再调整 Deployment 镜像，不要复制真实密钥到镜像里。

K8s 中 `TEMPORAL_ADDRESS` 由 Deployment **显式固定**为 `temporal-frontend.temporal.svc.cluster.local:7233`，即使本地 `.env` 里还保留过时的 `127.0.0.1:7233` 也不会把 Pod 指到自己。任何 Secret 更新以后需 `kubectl rollout restart deployment/...` 才生效。

## 6. Argo CD、Rollouts、Traefik、GitOps

本项目仍使用现有的官方 Argo/Traefik 配置与 GitOps manifest，依次安装（**只在确认 Kubernetes Context 后执行**）：

```sh
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd --server-side -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl create namespace argo-rollouts --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
helm repo add traefik https://traefik.github.io/charts
helm upgrade --install traefik traefik/traefik -n traefik --create-namespace --set service.type=LoadBalancer
kubectl -n argocd rollout status deployment/argocd-server --timeout=240s
kubectl -n argo-rollouts rollout status deployment/argo-rollouts --timeout=240s
# 仅本机实验：Portal 通过 cluster-local HTTP 访问内部 Argo API；勿向外网公开管理服务。
kubectl -n argocd patch cm argocd-cmd-params-cm --type merge -p '{"data":{"server.insecure":"true"}}'
kubectl -n argocd rollout restart deployment/argocd-server
kubectl -n argocd rollout status deployment/argocd-server --timeout=240s
curl -fsS http://portal.k8s.orb.local/api/health
```

核心发布实验（都在**仓库 dev** 对应版本执行，不要求另装 Linux VM）：

```sh
# 在门户中先登记测试应用和 TEST 环境，并记下两个 UUID
node scripts/p4-bootstrap.mjs <应用UUID> <环境UUID> > /tmp/marketplace-p4-app.yaml
kubectl apply -f /tmp/marketplace-p4-app.yaml
kubectl -n argocd get applications
# 先按 lab-publish.yml 从当前 master 的可信完整 CI 生成 healthy 镜像 Digest
# 再以成功 lab-publish Run ID 申请 GitOps PR，需人工审核合并到 dev：
GH_TOKEN="$(gh auth token)" node scripts/p4-open-promotion.mjs <发布RunID> healthy
kubectl -n marketplace-lab get rollout,pod,svc,ingress
kubectl argo rollouts get rollout marketplace-lab -n marketplace-lab --watch
# 蓝绿预览验证后再按需 promote，不能把 GitOps Synced 当成流量切换：
kubectl argo rollouts promote marketplace-lab -n marketplace-lab
curl -fsS http://lab.k8s.orb.local/version
```

详细的 LAB 应用 UUID/环境 UUID 绑定和不可变 GHCR Digest → GitOps PR → 蓝绿测试动作保留在 `p4/gitops/lab/` 与 `scripts/p4-bootstrap.mjs` / `scripts/p4-open-promotion.mjs`。它**仍是单应用实验，尚非通用 P4 发布适配器**；Argo Sync/Healthy 不等于真实流量已经切换。

实验可将 Argo Server 配为内部 HTTP（仅限集群 DNS，服务仅 ClusterIP），门户内部 API 已按固定的 Service 主机名限制连接；正式扩展时优先切回 TLS，不开放 Argo 管理 UI 到公网。现有 P4 只读/写动作令牌仍应分别授权。

## 7. Prometheus、Loki、Alloy（观察 Mac 资源后按需安装）

```sh
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm upgrade --install monitor prometheus-community/kube-prometheus-stack -n monitoring --create-namespace \
  --set alertmanager.enabled=false --set prometheus.prometheusSpec.retention=2d
kubectl -n monitoring get pods
```

按需安装 Loki / Alloy（若资源紧张，先完成 Temporal/Argo 核心链路，再安装）：

```sh
helm repo add grafana-community https://grafana-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
helm upgrade --install loki grafana-community/loki -n monitoring -f p4/observability/loki-values.yaml
helm upgrade --install alloy grafana/alloy -n monitoring -f p4/observability/alloy-values.yaml
kubectl apply -f p4/observability/lab-service-monitor.yaml
kubectl apply -f p4/observability/lab-alert-rule.yaml
```

完成核心服务稳定运行后，才视内存余量安装 `p4/observability/loki-values.yaml`、`alloy-values.yaml` 与 `lab-service-monitor.yaml`、`lab-alert-rule.yaml`。当前 Grafana/Loki 版本和 Helm 配置仍需本地联调，不应在安装报错时清空 PVC。

## 8. 从需求到发布的分层验证

- [ ] 在 **Pod** 中验证现有 PostgreSQL 可达；`market` 原有数据未变化，`temporal`、`temporal_visibility` 独立建库。
- [ ] Temporal Server 四类内部服务、Web UI 及应用 Activity Worker Ready，重启 Worker 后未完成的工作流可继续等待。
- [ ] 门户登录/需求中心/P5 代码任务仍可用，`TEMPORAL_ADDRESS` 是集群 Service 而非 Pod localhost。
- [ ] 新需求由 Temporal 创建 Workflow → 云端 LLM 方案 → 人工批准 → Copilot 任务（需要用户 Token 和服务资格）。
- [ ] Agent 完成后 PR 合并/CI 检查必须独立验证，才进入等待测试发布。**当前尚未自动调通 GitOps/Argo 发布的最后阶段**。
- [ ] GitHub 可信 GHCR Digest → GitOps PR → Argo Sync → Rollout 蓝绿 Preview/Promote → `/version` 校验 active 实例。
- [ ] 对 Temporal Server/Worker、门户和 Mac 重启进行恢复测试；检查 `kubectl top pods -A`，确认不 OOM。
- [ ] 数据库备份/恢复演练：market、temporal、temporal_visibility **分别备份**，不要只备份门户。

**以上全部在用户 Mac 上 NOT RUN。** GitHub CI/静态模板验证只能说明代码配置一致，不代表实际部署、网络、Token 或 GHCR Pull 已通过。

## 9. 维护规则

配置文件中的登录地址、镜像 Tag 仅供单机演示；正式使用应固定镜像 Digest、收敛 Secret 管理和部署版本。Temporal Chart 的 `numHistoryShards` 初始化后**不可随意修改**。所有真实密码只放 Mac 的本地 `.env.*` / K8s Secret，不能写进 GitOps 清单。**唯一的用户操作文档就是本文件**：旧 TEMP 指南仅作重定向。

官方参考：[OrbStack Kubernetes](https://docs.orbstack.dev/kubernetes/)、[OrbStack Networking](https://docs.orbstack.dev/docker/network)、[Temporal 官方 Helm Chart](https://github.com/temporalio/helm-charts)、[Temporal Worker Deploy](https://docs.temporal.io/develop/typescript/workers)。
