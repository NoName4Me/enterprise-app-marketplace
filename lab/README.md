# OrbStack 最小本机实验环境

只启动 PostgreSQL 和测试服务；门户在 macOS Node 上运行。不是生产部署。需 Docker Compose >=2.24.4（本机实测5.5.0）、ARM64 Docker、Node22、pnpm10.17.1。现有开发5432/门户3000不变，实验端口为55442/3380/3381。

从仓库根目录执行：

```sh
node lab/init-env.mjs
LAB_REVISION=$(git rev-parse HEAD) sh lab/run.sh up
node --env-file=lab/.env node_modules/drizzle-kit/bin.cjs migrate
node --env-file=lab/.env node_modules/next/dist/bin/next dev --port 3381 --hostname 127.0.0.1
```

init只生成一次0600权限的被Git忽略的lab/.env，不打印/覆盖凭据。迁移指向**新建的实验market_test**，不指向已有开发5432。up先检查端口，发现冲突立即退出，不停止已有服务；已启动后请用status/recover，不重复up。测试服务镜像只在本机构建；提交后重新按完整SHA构建，不能用未提交内容冒充该SHA的源码。

```sh
curl --fail http://127.0.0.1:3380/health
curl --fail http://127.0.0.1:3380/version
curl --fail http://127.0.0.1:3381/api/health
sh lab/run.sh status
sh lab/run.sh fault       # 预期退出码非零：健康503、容器unhealthy
sh lab/run.sh recover     # 预期健康200、容器healthy
sh lab/run.sh stop        # 停止容器/网络，保留实验数据卷
```

先Ctrl-C停止本人启动的门户，再stop。重启后实验数据仍在`marketplace-lab_lab_pg`；该卷与开发`market_pg`不同，不能执行down -v或全卷prune。首次演练仅使用合成数据，不导入员工资料。可用固定合成标记表核验持久性；不要在本实验库运行会清理fixture的自动测试，P0自动化使用独立临时容器55441。

故障只能由本机环境参数选择healthy/unhealthy，不能从HTTP注入。容器非root、只读文件系统、drop ALL capabilities、不挂Docker socket、64MiB上限、日志滚动；PostgreSQL256MiB上限。所有端口只绑定127.0.0.1。没有Jenkins/GitLab/Kubernetes/新监控系统。

本机实测见[证据](../docs/engineering/LAB_T01.md)。PR CI只验证服务/发布策略/Compose配置，并继续门户全套检查；它不部署用户Mac或发布GHCR。GATE-04已闭环。独立可信master成功CI可触发ARM64 GHCR发布，手动本机digest部署使用另一个端口3382和独立项目，见[LAB-T02手册](../docs/engineering/LAB_T02.md)。LAB-T01的环境故障恢复不等于镜像digest回滚，也不等于生产可靠性验证。
