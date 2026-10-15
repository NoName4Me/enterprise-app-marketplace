# P4 临时 Mac mini 指南（已并入统一部署指南）

**请只使用 [docs/MAC_MINI_SETUP.md](MAC_MINI_SETUP.md) 进行 Mac mini 部署。**

旧版独立安装方法（macOS `temporal server start-dev` + SQLite、macOS 后台 Worker）已经废弃；**不要执行**。Temporal Server 和应用 Worker 均部署在 OrbStack Kubernetes，Temporal 复用已有 PostgreSQL 实例中独立的两个数据库。旧版 P4 说明中的端口转发与宿主机 localhost 不能直接用于 Pod，现已在统一指南中按集群 DNS 修订。

保留此文件仅为兼容旧链接。尚未在用户 Mac 执行安装或验收（NOT RUN）。
