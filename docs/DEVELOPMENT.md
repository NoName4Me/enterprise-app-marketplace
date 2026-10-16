# OrbStack 开发环境与 GitHub CI/CD

用户 Mac mini M4/16GB/256GB 已在 OrbStack 运行过项目，开发 PostgreSQL **可能已有数据**。不能擅自 `docker compose down -v`、`docker volume prune`、清理数据库、覆盖 `.env`。

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
docker compose up -d         # 保留已有卷
pnpm dev
```

仅在核对目标 `DATABASE_URL` 后执行 `pnpm db:migrate`；已有管理员不能重复 bootstrap。自动化测试用隔离数据库。

隔离 LAB 使用 55442 PostgreSQL / 3380 测试服务 / 3381 门户，已在 M4/OrbStack 实验：

```sh
node lab/init-env.mjs
LAB_REVISION=$(git rev-parse HEAD) sh lab/run.sh up
node --env-file=lab/.env node_modules/drizzle-kit/bin.cjs migrate
sh lab/run.sh status
sh lab/run.sh fault       # 预期失败
sh lab/run.sh recover
sh lab/run.sh stop        # 保留数据
```

## CI 的两种强度

- PR → master：保留 GitHub 必需检查 `check` 和 `validate` 名称；`validate` 快速执行锁定安装、隔离数据库迁移、TypeScript/ESLint/Build；普通业务功能**不默认要求新增测试**。
- master push：仍执行生产依赖 audit、管理员初始化、所有已有单元/DB/E2E、实验脚本与 Docker 冒烟；完整测试在合并后/发布前运行，勿误把 PR 通过叫完整验收。
- 没有部署生产，也不接公网 Mac Docker Socket；监控、Jenkins、GitLab Server、K8s 不提前建设。

## 实验 GHCR 按需发布

原先 master CI 成功自动触发 LAB 镜像发布，现改成**手动**。先找到**当前 master HEAD** 对应成功 `push` 完整 CI Run ID，然后：

```sh
gh workflow run lab-publish.yml --ref master -f ci_run_id=<当前master的成功CI Run ID>
gh run list --workflow lab-publish.yml --limit 5
node lab/deploy.mjs <成功发布Run ID> healthy
node lab/deploy.mjs <同一Run ID> unhealthy  # 预期回滚且非零
node lab/deploy.mjs status
node lab/deploy.mjs stop
```

发布 job 只对受信当前 master CI、仓库、`validate` 成功进行校验，才获得短期 `packages:write` 并构建 ARM64 digest。旧 `workflow_run` 发布记录继续保持核验兼容。**变更目前只在 dev 分支，未进入默认分支前不可声称手动新工作流已在云端验证。** Mac 单机摘要回滚不等于生产高可用或数据库回滚。历史证据在 PR #17/#24。
## GitHub 资产只读同步（P1-02）

在应用维护者或管理员的私有资产工作台登记 GitHub 仓库/Workflow 后，点击“读取 GitHub 最新信息”查询最近提交、PR 与 Actions。请求只访问 GitHub 官方 REST API，不新增数据库和定时采集；结果只读，有来源、读取时间与不可访问/未知状态。CI 成功 **不代表** 镜像已部署、环境健康或目标应用实际可用。

公开仓库无需令牌；私有仓库可在本地服务器 `.env` 中配置 `GITHUB_READ_TOKEN` 与 `GITHUB_ALLOWED_REPOS`（逗号分隔 `owner/name`，参照 `.env.example`）。建议使用仅授予指定仓库的 GitHub fine-grained token、只读 Contents/Pull requests/Actions 权限；**只有列入允许清单的仓库才会携带令牌**。不要把令牌写进网页、仓库或镜像，缺少权限时界面显示无法访问。API 读取频率有基本限流缓存，点击后才发起查询；真实部署与监控仍在 P4 实现。


## P4：Argo CD 运行状态只读接入（首批）

门户保留原有应用市场与 P1 资产身份，不重复实现 Kubernetes/Argo CD。当前新增 **按需读取** Argo CD Application 的 GitOps 同步状态、资源健康、最近同步版本与镜像摘要（不是在线业务探活，也不开放生产写权限）。需要已经存在、由专业系统实际管理的 Argo CD 集群；本仓库提交代码不会自动给 Mac mini 安装 k3s/Argo。

在门户服务端配置 \`ARGOCD_SERVER_URL\`、\`ARGOCD_READ_TOKEN\` 与 \`ARGOCD_ALLOWED_PROJECTS\`（逗号分隔），仅允许 HTTPS 连接；本机 localhost 可以 HTTP。令牌在 Argo CD 中使用专门的只读 Project role，限定 \`applications,get\`（含 list 所需权限），不能使用管理员/同步令牌。

使用现有应用资产的 UUID 建立来源映射：为 Argo CD **Application** 对象添加两个 metadata.labels（不设置在工作负载 Pod 上）：

\`\`\`yaml
metadata:
  labels:
    marketplace-app-id: "应用 UUID（applications.id）"
    marketplace-environment-id: "环境 UUID（app_environments.id）"
spec:
  project: marketplace-lab  # 必须在 ARGOCD_ALLOWED_PROJECTS 中
\`\`\`

维护者或管理员打开应用私有工作台，点击「读取实际 GitOps 状态」。后端**先检查当前登录用户对该应用的权限**，只向运营配置的 Argo CD API 发起固定标签筛选请求，响应再次验证应用/活跃环境 UUID 和项目允许列表；不返回令牌、其他应用资料，也不访问任意登记的 URL。未连接、查询错误、无匹配明确分开显示。任何 GitHub CI 结果或 GitOps Synced 状态均不能被门户当作实际发布成功，更不能当成流量已切换。

下一批应在现有 LAB 验证基础上配置单台 Mac mini 内的 Linux/k3s 集群、Argo CD / Argo Rollouts 和受控 GitOps 仓库，并验证：可信镜像 Digest → GitOps 目标更新 → Argo 实际调谐 → Rollout 健康 → 门户只读状态；随后再接 Prometheus/Loki 证据与 AI 只读诊断。现阶段**尚未执行** Mac 安装或端到端验收，禁止将此功能标为生产部署完成。

## P3/P5 需求中心和云端编码联调

- 新增数据库迁移 0008_requirements_coding_tasks.sql（需求、评论、Coding Agent 任务）；CI 在隔离 PostgreSQL 上验证，**不要跳过目标 DATABASE_URL 检查直接迁移 Mac 上有数据的库**。
- 员工访问 /requirements，已上架应用详情可以链接提交该应用的缺陷和功能需求。维护者认领处理并记录 GitHub Issue/PR；处理完成是人工登记，不能据此认定 CI/发布成功。
- 使用当前 `.env` 中的 `AIOPS_LLM_API_KEY`（或 `DEEPSEEK_API_KEY`），`AIOPS_LLM_BASE_URL`，`AIOPS_LLM_MODEL` 供 P4 诊断和 P3 应用语义排序共用。默认不把原始 Loki 日志送给第三方模型。只读取服务端变量，不在浏览器暴露密钥。
- P5 选用 GitHub Copilot Cloud Agent 的公开 API；需要 `P5_COPILOT_USER_TOKEN`（**用户令牌**，非 GitHub App 安装令牌）和 `P5_ALLOWED_REPOS`。仅允许应用 owner 向明确登记且未归档、白名单内唯一 GitHub 仓库派发任务；需要该仓库启用/有权限使用 Copilot Cloud Agent。外部任务超时会记录 UNKNOWN，必须人工核对后处理。
- P5 任务默认以 dev 为基线并请求 GitHub 创建 PR，**不会自动合并、测试环境发布或改动 Mac 本地文件**。普通运维 Token 与 Coding Agent Token 分开。

## Mac mini 服务器唯一部署指南（2026-10-15）

OrbStack Kubernetes、已有 Compose PostgreSQL、Temporal Server/UI/Worker、门户、Argo CD 与观测栈的统一部署与未实测验收参见 **[MAC_MINI_SETUP.md](MAC_MINI_SETUP.md)**。不要再使用 TEMP_ 指南中的 macOS SQLite/本地 Temporal Server 命令。
