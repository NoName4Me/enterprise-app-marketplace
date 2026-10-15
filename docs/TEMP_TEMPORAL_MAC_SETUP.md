# Temporal 本机实验指南（临时）

> 还未在 Mac mini 上实测。保留原有 OrbStack、PostgreSQL 和 Compose 数据，绝不清理卷。Temporal 属于企业应用门户内部长期任务服务，不是独立产品。

## 设计

需求编辑、评论和业务权限仍保存在 PostgreSQL；AI 分析、人工审批等待、Agent 编码任务、后续 GitHub PR/CI、GitOps 发布和故障恢复交给 Temporal Workflow。Workflow 必须是确定性代码；外部模型、GitHub 和 Argo 操作在 Activity 中。不要复制 aiops-agent 的 Code RAG、补丁器、沙箱或部署算法。

## Mac mini M4 / 16 GB 首次实验

初期采用 Temporal 官方 CLI development server，使用 SQLite 文件持久化事件历史；比另建一套 PostgreSQL/Kubernetes Temporal 更适合最快验证，**开发模式不是生产级 Temporal 部署**。以后可替换为官方自托管服务器 + 独立 PostgreSQL 数据库，不复用门户数据表。

```sh
brew install temporal
mkdir -p "$HOME/Library/Application Support/enterprise-marketplace"
temporal server start-dev --db-filename "$HOME/Library/Application Support/enterprise-marketplace/temporal.db"
```

默认 gRPC 地址 127.0.0.1:7233，Temporal UI http://localhost:8233 。保留 SQLite 文件，重启后使用相同命令恢复历史。

另开终端，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm temporal:worker
```

门户 Next.js 进程照旧独立运行，Worker 读取 .env，不放在 next dev 热重载进程里。Mac 上无需 Ollama。

```ini
TEMPORAL_ADDRESS=127.0.0.1:7233
TEMPORAL_NAMESPACE=default
DEEPSEEK_API_KEY=<cloud-api-key>
AIOPS_LLM_BASE_URL=https://api.deepseek.com
AIOPS_LLM_MODEL=deepseek-flash
P5_COPILOT_USER_TOKEN=<github-user-token>
P5_ALLOWED_REPOS=NoName4Me/enterprise-app-marketplace
```

## 第一条交付工作流

1. 在门户给已上架应用登记一个允许列表内、未归档的 GitHub Repository；以应用负责人账号提交 P3 功能/缺陷需求。
2. 进入需求详情，启动 Temporal 交付任务，Workflow ID 固定为 portal-delivery-<需求UUID>，相同需求不能自动重复创建。
3. Worker 通过云端模型给出实施建议；模型不可用时展示待人工核对内容，状态为 AWAITING_APPROVAL。
4. 负责人明确批准后，Activity 才调用 GitHub Copilot Cloud Agent Tasks API；请求只派发一次（HTTP 超时不盲重试）。拒绝请求时不会创建任务，结果不明须到 GitHub 人工核对。
5. 受理后每 5 分钟轮询 GitHub Task 状态。Agent 结束只是 AWAITING_PR_REVIEW，不能表示 PR 已审核、CI 通过或已经发布。当前首批到此为止；PR/CI/Argo 自动等待是下一批。
6. 通过 Temporal UI 验证历史记录，停掉 Worker、重新启动，确认未完成的工作流继续；停止 Temporal 开发服务器再运行同一 SQLite 文件，确认历史保留。

当前 P5 首批仅支持**已有应用的开发需求**。NEW_APP 尚无模板仓库创建 Activity。旧的直接 Copilot 任务若已存在，保持历史不自动迁移，不能直接重发；新入口默认走 Temporal。

## 之后继续接入

P3：AI 拆解 → 人审 → 新仓库模板；P5/P6：编码 → PR/CI → 人审 → GitOps PR；P4：Argo 部署和运行指标验证；P7：告警 → AI 建议 → 人审 → 受控修复和回滚；P8：组合 0→1 应用交付。Temporal 管状态和等待，GitHub/Argo/Prometheus 才是外部事实源。

## 验收状态

本文件全部命令、Temporal Worker 实机运行、GitHub Copilot 真实任务及 PR、Mac 上历史恢复：NOT RUN。无本地大模型，无自动合并、生产部署或 Code RAG。

官方参考：https://docs.temporal.io/develop/typescript/workflows ，https://docs.temporal.io/cli
