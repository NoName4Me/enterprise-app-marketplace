# LAB-T00/T01 本机证据

日期：2026-10-14。环境是用户真实 Mac mini，而不是云端模拟配置。

## 实测设备与隔离

- Apple M4 / arm64 / 16GiB / macOS26.3；磁盘228GiB可用约106GiB。
- Docker29.8.2，context=orbstack，Linux/aarch64；Compose5.5.0；OrbStack memory_mib=8192，Docker可见约7.816GiB。
- Node22.23.3、pnpm10.17.1。已有5432数据库与3000门户正在使用，保留原进程、数据和容器。
- 本批仅增量创建marketplace-lab项目：PostgreSQL55442、测试服务3380、宿主门户3381，全部绑定127.0.0.1。复用根compose的PostgreSQL定义，通过!override更换端口和数据卷；实验卷marketplace-lab_lab_pg与开发卷完全分离。
- 本地生成的lab/.env权限0600且Git忽略；初始化拒绝覆盖（EEXIST退出1为预期负例），从未输出实际凭据。

## 真实执行与结果

| 检查 | 状态/证据 |
| --- | --- |
| node lab/preflight.mjs | PASS，Mac ARM64、Docker、三个实验端口可用；无停止既有服务 |
| LAB_REVISION=<完整SHA> sh lab/run.sh up | PASS，Docker本机arm64构建，PostgreSQL/test-service均healthy |
| 隔离DB迁移 | PASS，node --env-file=lab/.env node_modules/drizzle-kit/bin.cjs migrate退出0 |
| 门户宿主进程 | PASS，本机Node运行Next16.3.8，/api/health=200、/login=200、匿名/api/apps=401 |
| 测试服务 | PASS，/health=200，/version报告真实镜像构建参数；不提供HTTP故障写入口 |
| 固定故障 | PASS，sh lab/run.sh fault预期退出1，实际容器unhealthy，/health=503，/version仍200 |
| 恢复 | PASS，sh lab/run.sh recover退出0，容器healthy、/health=200 |
| 数据持久性 | PASS，合成lab_persistence_probe标记在stop后重新up仍存在 |
| 停止与清理 | PASS，宿主门户停止，lab stop移除本批容器/网络；实验数据卷保留，未执行down -v/prune |
| 服务端测试 | PASS，node --test lab/test-service/server.test.mjs：2/2 |
| 仓库检查 | typecheck/lint/单元和最新SHA完整CI结果见本批PR；没有替代真实Mac验收 |

初次调试发生在未提交工作树，构建参数为基线5af462a，不能用它证明新增服务来自该提交。**最终PR提交的完整SHA、本机重新构建/版本断言和镜像ID写入PR**，防止自引用文档提交误报源码身份。当前本机构建镜像不是GHCR制品，不把镜像ID/本地manifest当成GHCR digest证据。

## 实测资源（一次低负载采样，非固定承诺）

- PostgreSQL22.78MiB / 256MiB，实验服务13.61MiB / 64MiB；宿主门户RSS约98MiB。
- 实验卷约48.68MB；全机镜像3.1GB、卷448.1MB、构建缓存3.879GB。后者包含既有容器和P0构建，不能归为实验服务独占占用。
- 容器实际inspect：user=node、ReadonlyRootfs=true、CapDrop=[ALL]、64MiB内存限制、health=healthy。无Docker Socket、SSH或公网绑定。

## LAB-T02 边界

BLOCKED：P0-T02真实分支保护尚待GitHub二次认证保存和失败PR阻断实测。未发布GHCR、未执行GHCR按digest拉取/回滚、未验证package访问策略。已有故障恢复仅证明本机固定故障可恢复，不能冒充LAB-02/03/04、生产可靠性或无人值守发布。

下一唯一推荐动作：完成GitHub真实合并保护并实测失败PR阻断；再单独执行LAB-T02可信arm64镜像发布、digest部署和回滚。本批没有安装Jenkins、GitLab、Kubernetes或监控平台。
