# Temporal Kubernetes deployment config

This is a module of the **single** [Mac mini setup](../../docs/MAC_MINI_SETUP.md); do not run the obsolete stand-alone Temporal SQLite setup.

- `values.yaml`: **official Temporal Helm Chart 1.7.0** PostgreSQL configuration, one replica of each Temporal server service, separate `temporal` and `temporal_visibility` databases on existing PostgreSQL.
- `bootstrap-databases.psql`: additive SQL to create only the two Temporal databases and a dedicated role.
- `Dockerfile.worker`: builds the application Activity Worker as an ARM64-capable Node image; no Ollama, model or repository shell access.
- `worker.yaml`: one dedicated application Worker pod (not the server's internal Temporal worker) in the `marketplace` namespace.
- Secrets `temporal/temporal-db-secret` and `marketplace/portal-worker-runtime` must be created locally from files **ignored by git**.

**Never run the Temporal server chart against the `market` application database.** Validate PostgreSQL networking and a backup before deploying.

## 托管发布 Worker 扩展（2026-10-15）

新 Worker 在执行原有 Coding Agent Activities 外，还使用现有 `market` 数据库写 `hosted_releases` 和 `app_hosted_ports` 以更新经过核验的发布状态。应提供最小权限的专用数据库账号（仅授权读应用/环境/发布状态及写发布记录/端口记录），而不是暴露 PostgreSQL 超级用户。K8s Secret `portal-worker-runtime` 必须加入 `DATABASE_URL`、`HOSTED_GITHUB_SOURCE_TOKEN`、`HOSTED_GITOPS_TOKEN`、`HOSTED_ARGO_APPLICATION_TOKEN`、`ARGOCD_SERVER_URL`、`HOSTED_PUBLIC_IP`。Worker 不接受用户输入的 API 端点；固定访问 GitHub、受信 Argo Service 与内网固定 IP。完整步骤见 [HOSTED_RELEASE.md](../../docs/HOSTED_RELEASE.md)。
