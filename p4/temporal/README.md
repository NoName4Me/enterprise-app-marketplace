# Temporal Kubernetes deployment config

This is a module of the **single** [Mac mini setup](../../docs/MAC_MINI_SETUP.md); do not run the obsolete stand-alone Temporal SQLite setup.

- `values.yaml`: **official Temporal Helm Chart 1.7.0** PostgreSQL configuration, one replica of each Temporal server service, separate `temporal` and `temporal_visibility` databases on existing PostgreSQL.
- `bootstrap-databases.psql`: additive SQL to create only the two Temporal databases and a dedicated role.
- `Dockerfile.worker`: builds the application Activity Worker as an ARM64-capable Node image; no Ollama, model or repository shell access.
- `worker.yaml`: one dedicated application Worker pod (not the server's internal Temporal worker) in the `marketplace` namespace.
- Secrets `temporal/temporal-db-secret` and `marketplace/portal-worker-runtime` must be created locally from files **ignored by git**.

**Never run the Temporal server chart against the `market` application database.** Validate PostgreSQL networking and a backup before deploying.
