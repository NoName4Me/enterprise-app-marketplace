# Mac mini 统一服务器部署与验收（OrbStack Kubernetes）

> **唯一主入口**。目标硬件：**一台 Mac mini M4 / 16GB**，已安装 OrbStack。**已于 2026-10-15 完成核心部署，2026-10-16 完成首个托管应用 TEST 发布；云端 AI/生产发布仍为 NOT RUN**。任何出现错误的步骤先停止并排查，不要重置/清空现有数据库或卷。关联：`p4/temporal/`、`p4/platform/`、`p4/gitops/lab/`、`p4/observability/`。

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
# 缺少 Helm 时先安装：brew install helm
kubectl config current-context
kubectl get nodes -o wide
docker compose -f compose.yaml ps postgres
docker volume ls | grep market_pg
docker compose -f compose.yaml exec -T postgres pg_isready -U market -d market
kubectl top nodes || true
```

先检查 `kubectl` 当前 Context **确实是 OrbStack**，不要误操作其他集群。**不要执行** `docker compose down -v`、`docker volume prune`、`orb delete k8s`、`pg_dropcluster`、`DROP DATABASE`。建议先备份已有 market 数据库（在 Mac 的受保护目录）：

```sh
umask 077
mkdir -p "$HOME/marketplace-backups"
market_backup_path="$HOME/marketplace-backups/market-before-p4-$(date +%Y%m%d-%H%M%S).dump"
docker compose -f compose.yaml exec -T postgres pg_dump -U market -Fc market > "$market_backup_path"
test -s "$market_backup_path"
```

若系统已有本机网络代理，但终端下载失败，先为下载命令设置 `HTTP_PROXY` / `HTTPS_PROXY`，并将 `localhost,127.0.0.1` 放入 `NO_PROXY`。OrbStack 可通过 `orb config set network_proxy <本机代理URL>` 显式使用同一代理；不要把代理凭据写入 Git。镜像构建依赖下载可使用 Docker 预定义代理 build args，例如 `--build-arg HTTP_PROXY=http://host.orb.internal:<端口> --build-arg HTTPS_PROXY=http://host.orb.internal:<端口>`（Pod 访问集群服务应绕过代理）。如果 BuildKit 在 `docker/dockerfile:1` 获取 Token 时仍 DNS 超时，先用 `docker pull docker/dockerfile:1` 检查代理；也可将 `tail -n +2 Dockerfile` 的内容传给 `docker build -f - .`，跳过外部 syntax frontend 下载，Worker 同理。

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
# 本机实测：短域名 temporal-frontend:7233 会超时，必须使用完整 Service DNS。
# Chart 1.7.0 内置 namespace hook 使用短域名，因此 values.yaml 禁用该 hook。
kubectl -n temporal run temporal-namespace-bootstrap --rm -i --restart=Never \
  --image=temporalio/admin-tools:1.32.0 --command -- sh -ec \
  'temporal --address temporal-frontend.temporal.svc.cluster.local:7233 operator namespace describe -n default || temporal --address temporal-frontend.temporal.svc.cluster.local:7233 operator namespace create -n default --retention 7d'
kubectl -n temporal get pods,svc,jobs
kubectl -n temporal logs deployment/temporal-frontend --tail=60
```

其中 `values.yaml` 的 `createDatabase: false` 表示不会替你创建/覆盖数据库；`manageSchema: true` 由 **Temporal Helm 的 Schema Job** 初始化并升级 `temporal` / `temporal_visibility`。这两个库必须事先创建，数据库账号需要相应所有权。不要给 `market` 运行 Temporal 的 Schema 初始化。

`server.publicClientHostPort` 与 `web.temporalAddress` 同样固定完整 Service DNS，避免内部 Worker 和 UI 使用短域名。`default` 命名空间创建完成后再部署业务 Worker。

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

`.env.portal.k8s`：从现有 Mac `.env` **复制必要的服务端配置值**，其中 `DATABASE_URL` 改为 Pod 实测可达的 PG 主机名（**不是 localhost**），`BETTER_AUTH_URL=http://portal.k8s.orb.local` 与实际浏览器地址匹配；包含原 `BETTER_AUTH_SECRET`、DeepSeek API 和门户访问外部源所需的 Token。端口使用 `ARGOCD_SERVER_URL=http://argocd-server.argocd.svc.cluster.local`、`PROMETHEUS_SERVER_URL=http://monitor-kube-prometheus-st-prometheus.monitoring.svc.cluster.local:9090`、`LOKI_SERVER_URL=http://loki-gateway.monitoring.svc.cluster.local:80`（后两者安装后才可用；Prometheus Service 名以 `kubectl -n monitoring get svc` 为准，Chart 可能截断名称）。

`.env.worker.k8s`：新版 Worker 需要指向现有 `market` 的 Pod 可达 `DATABASE_URL`，用于托管发布账本（不另建数据库）。按已接入功能添加 `DEEPSEEK_API_KEY`（或 `AIOPS_LLM_API_KEY`）、模型配置、`P5_COPILOT_USER_TOKEN`；托管发布所需 GitHub/受限 Argo 凭据见 [HOSTED_RELEASE.md](HOSTED_RELEASE.md)。不放门户会话 Secret，也不因启用测试发布自动授予生产权限。

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
kubectl apply -n argocd --server-side -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.5/manifests/install.yaml
kubectl create namespace argo-rollouts --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argo-rollouts --server-side -f https://github.com/argoproj/argo-rollouts/releases/download/v1.10.1/install.yaml
helm repo add traefik https://traefik.github.io/charts
helm upgrade --install traefik traefik/traefik --version 41.7.1 -n traefik --create-namespace --set service.type=LoadBalancer
kubectl -n argocd rollout status deployment/argocd-server --timeout=240s
kubectl -n argo-rollouts rollout status deployment/argo-rollouts --timeout=240s
# 仅本机实验：Portal 通过 cluster-local HTTP 访问内部 Argo API；勿向外网公开管理服务。
kubectl -n argocd patch cm argocd-cmd-params-cm --type merge -p '{"data":{"server.insecure":"true"}}'
kubectl -n argocd rollout restart deployment/argocd-server
kubectl -n argocd rollout status deployment/argocd-server --timeout=240s
curl -fsS http://portal.k8s.orb.local/api/health
```

Rollouts CRD 较大，使用 `--server-side` 避免客户端 apply 的 annotation 超过 256 KiB。以上控制器版本为本机已验证版本。

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
helm upgrade --install monitor prometheus-community/kube-prometheus-stack --version 92.7.0 -n monitoring --create-namespace \
  --set alertmanager.enabled=false --set prometheus.prometheusSpec.retention=2d \
  --set prometheus.prometheusSpec.resources.requests.memory=256Mi \
  --set prometheus.prometheusSpec.resources.limits.memory=768Mi \
  --set grafana.resources.requests.memory=64Mi --set grafana.resources.limits.memory=512Mi
kubectl -n monitoring get pods
```

按需安装 Loki / Alloy（若资源紧张，先完成 Temporal/Argo 核心链路，再安装）：

```sh
helm repo add grafana-community https://grafana-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
helm upgrade --install loki grafana-community/loki --version 18.15.1 -n monitoring -f p4/observability/loki-values.yaml
helm upgrade --install alloy grafana/alloy --version 1.13.1 -n monitoring -f p4/observability/alloy-values.yaml
kubectl apply -f p4/observability/lab-service-monitor.yaml
kubectl apply -f p4/observability/lab-alert-rule.yaml
```

完成核心服务稳定运行后，才视内存余量安装 `p4/observability/loki-values.yaml`、`alloy-values.yaml` 与 `lab-service-monitor.yaml`、`lab-alert-rule.yaml`。本机已验证 Loki Chart 18.15.1 / Alloy Chart 1.13.1，包含单机内存限制；门户 Pod 查询 Loki 标签及 marketplace 日志成功。实验应用尚未部署，因此 ServiceMonitor/告警规则的业务信号仍为 NOT RUN。不应在安装报错时清空 PVC。

## 8. 从需求到发布的分层验证

- [x] 在 **Pod** 中验证现有 PostgreSQL 可达；保留 `market` 原有业务记录并执行增量迁移，`temporal`、`temporal_visibility` 独立建库。
- [x] Temporal Server 四类内部服务、Web UI 及应用 Activity Worker Ready，重启 Worker 后未完成的工作流可继续等待。
- [ ] 门户登录/需求中心/P5 代码任务仍可用，`TEMPORAL_ADDRESS` 是集群 Service 而非 Pod localhost。
- [ ] 新需求由 Temporal 创建 Workflow → 云端 LLM 方案 → 人工批准 → Copilot 任务（需要用户 Token 和服务资格）。
- [ ] Agent 完成后 PR 合并/CI 检查必须独立验证，才进入等待测试发布。**当前尚未自动调通 GitOps/Argo 发布的最后阶段**。
- [ ] GitHub 可信 GHCR Digest → GitOps PR → Argo Sync → Rollout 蓝绿 Preview/Promote → `/version` 校验 active 实例。
- [ ] 对 Temporal Server/Worker、门户和 Mac 重启进行恢复测试；检查 `kubectl top pods -A`，确认不 OOM。
- [x] 数据库备份/恢复演练：market、temporal、temporal_visibility **分别备份并成功恢复到新的隔离校验库**；未覆盖业务库。

**2026-10-15 本地实测结果**：

- PASS：Pod → 原 Compose PostgreSQL；三个业务库独立，原账号与应用数量保持不变。迁移先在 `marketplace_setup_verify` 隔离库通过，再将 `market` 从 8 条迁移升级至 9 条。
- PASS：Temporal Chart 1.7.0 / Server 1.32.0 的 frontend、history、matching、内部 worker、Web UI 及业务 Worker 运行；门户健康接口和登录页返回 200，未登录读取需求/工作流返回 401。
- PASS：真实 `deliveryWorkflow` 进入人工等待；Server 与 Activity Worker 重启后同一 run 继续等待，拒绝后结束；无 Copilot Token 的批准分支返回 `PROVIDER_REJECTED`，未产生外部任务。此项通过 SDK 验证，不能替代门户不同账号的业务验收。
- PASS：Argo CD 3.5.5、Rollouts 1.10.1、Traefik 41.7.1、Prometheus Stack 92.7.0 部署（Grafana 启动时 256Mi 上限触发 OOM，已调至 512Mi）；门户 Pod 到 Argo 健康接口与 Prometheus 就绪接口返回 200。
- PASS：Loki 18.15.1 / Alloy 1.13.1；从门户 Pod 成功查询已采集的 marketplace 日志。三个数据库分别备份并恢复到隔离库，备份放在用户主目录的受保护 `marketplace-backups` 中。
- NOT RUN：门户真实账号登录与需求派发全链路、云端模型/Copilot、可信 GHCR → GitOps PR → 蓝绿切流/回滚、Mac 整机重启。用户选择本轮先验本地核心链路，不能将上述项目标为通过。

本机门户入口为 `http://portal.k8s.orb.local`。Temporal UI 使用上文仅绑定 loopback 的端口转发。`kubectl top` 依赖 Metrics Server，本机尚未安装；可用 Prometheus 和 `docker stats --no-stream` 检查资源。GitHub CI/静态模板检查不代表真实发布或 Token 已验证。

## 9. 维护规则

配置文件中的登录地址、镜像 Tag 仅供单机演示；正式使用应固定镜像 Digest、收敛 Secret 管理和部署版本。Temporal Chart 的 `numHistoryShards` 初始化后**不可随意修改**。所有真实密码只放 Mac 的本地 `.env.*` / K8s Secret，不能写进 GitOps 清单。**唯一的用户操作文档就是本文件**：旧 TEMP 指南仅作重定向。

官方参考：[OrbStack Kubernetes](https://docs.orbstack.dev/kubernetes/)、[OrbStack Networking](https://docs.orbstack.dev/docker/network)、[Temporal 官方 Helm Chart](https://github.com/temporalio/helm-charts)、[Temporal Worker Deploy](https://docs.temporal.io/develop/typescript/workers)。

## 本轮应用门户改版的增量部署（2026-10-15）

Mac mini 核心环境已经部署完成，本轮**不要重跑完整安装步骤**。从最新 `dev` 合入镜像前，仅针对已有 `market` 数据库执行**增量** Drizzle 0009/0010 迁移：0009 为旧应用加 `source_kind=EXTERNAL` 默认值，新托管应用可登记仓库；0010 新增平台 NodePort 预约表。不要重建 PostgreSQL/Temporal/Argo，也不要清理卷。照项目原有数据库迁移流程先确认 DATABASE_URL 指向 `market`，备份后运行 `pnpm db:migrate`。

### 固定 IP + 独立 NodePort
- 不使用不同 `/path` 作为不同应用入口。测试和生产各预留一个平台端口，范围 `31000–31999`，由数据库唯一约束与事务锁避免**平台内部**冲突。
- 管理员在**门户 K8s Secret** `portal-runtime` 对应本地环境文件设置 `HOSTED_PUBLIC_IP=<Mac 的稳定局域网 IPv4>`。此值仅用于已验证的 READY URL 展示，不能自动开放端口。
- **先检查** `kubectl get svc -A -o wide` 是否已有其他服务使用同一端口；数据库预约不等于集群端口冲突检查。
- 部署控制器必须先部署 Kubernetes Service `type: NodePort`，并实际从客户端执行 `curl http://<IP>:<port>/...` 或应用自己的健康探测，然后才能记录 READY+verifiedAt。OrbStack NodePort 是否从局域网可达**仍需实机验证**；若不通先调整受控入口映射，不要提前把预留 URL 暴露给员工。
- 当前应用门户还没有可泛化的 GHCR 镜像构建和 Kubernetes 发布器，因此页面会明确提示尚未部署。旧 `marketplace-lab` 故障演练表单已从普通发布工作台移出；不删除底层存量记录。


## 后续代码进展与本地 Agent 增量操作（2026-10-15）

**不必重新安装** OrbStack、PostgreSQL、Temporal、Argo 或监控。请等最新 dev 的 CI 通过后，才在 Mac 进行下列增量工作：

1. `git fetch origin && git checkout dev && git pull --ff-only origin dev`；确认没有覆盖 Mac 上未提交的 .env 或工作区文件。
2. 先确认原来的 market 数据库有可恢复备份，核对 `DATABASE_URL` 实际指向 market 而不是 temporal，然后执行一次 `pnpm db:migrate`（0009 和 0010）；检查应用原数据无变化。
3. 按原有 Portal 镜像部署方式更新**仅门户服务**，不要清理 `market_pg` 等已有卷；门户使用的 `ARGOCD_ALLOWED_PROJECTS` 将来需允许 `marketplace-hosted`，但先由 Argo 管理员核对权限。
4. `kubectl get svc -A -o wide` 检查 NodePort `31000–31999` 是否冲突。`HOSTED_PUBLIC_IP` 只设置为经 Mac/LAN 客户端测试可达的固定 IPv4。**现在仅预约端口，不会创建 NodePort Service 或开放访问**。
5. `node --test scripts/p4-hosted-manifest.test.mjs` 可在 Mac 非破坏性运行。通用部署尚未完成之前，不要把渲染出的 YAML 直接当生产发布操作执行；真实验证步骤详见 `docs/HOSTED_RELEASE.md`。

当前最需要本地 Agent 返回的事实：`kubectl get nodes`、`kubectl get svc -A`（移除任何私密信息后）、固定 IP:NodePort 从 LAN 的连通性、与 GitHub GHCR 对应源仓库的权限限制。这些只影响后续真实部署联调，不阻碍继续编写代码。

## 退役六条内置假应用 + 删除初始草稿（增量维护）

**不重装服务、不清理任何 Docker/PG 卷。** `demo:seed` 已取消，原 `seed-demo.ts` 不再执行。为避免误碰真实数据，只允许按原种子发布者 `demo-publisher@example.test`、六个精确名称、对应 `https://example.com/...` URL 和专门的示例说明匹配记录；**有需求、使用申请、资产绑定或托管资源的记录自动跳过**。模拟评论/星级/收藏随这些演示应用的数据库级联关系被清理；测试账号本身不删除。

在已完成 `0009`、`0010` 增量迁移的 Mac mini 本地工作树中（只针对 `market` 库）：

```sh
# 确认 DATABASE_URL 连接的是 market，而非 temporal
# 清理前先用已有的 PG 备份流程保存 market
pnpm demo:cleanup           # 预览命中对象；不修改数据库
pnpm demo:cleanup --apply   # 仅清理预览过的 6 个老式演示应用
pnpm demo:cleanup           # 结果应显示 0 个匹配
```

上面的命令**未由本次远程代码修改在你的 Mac 执行**。如预览显示不属于内置演示的应用，**停止，不执行 --apply**。这与删除任意用户草稿是两种操作，切勿通过编辑 SQL 解除限制。

应用负责人可在「我管理的应用 → 应用详情 → 设置 → 删除此草稿」删除**唯一初始 DRAFT、从未送审、无需求/访问/运行记录**的应用。托管草稿还会释放仅处于 RESERVED 状态的 TEST/PRODUCTION 端口；一旦提交市场审核或实际部署，后端拒绝直接删除。不同账号无法删除不属于自己的草稿。

## 托管应用真正发布的增量配置（0011）

**这不是重新安装指南。** 新版发布由 [HOSTED_RELEASE.md](HOSTED_RELEASE.md) 说明，需源仓库管理员安装构建 Workflow 模板、更新已有门户与 Worker 的 Kubernetes Secrets、更新 Worker ARM64 镜像，在 `market` 备份后仅执行新的 `0011` 迁移。初次通用发布还需要经 GitHub 人工批准 GitOps PR；验证 Argo 与 LAN NodePort，不能通过 CI 结果代替现场核验。项目的 PostgreSQL/Temporal/Argo/K8s 实例和所有现有卷**不重建、不清空**。
