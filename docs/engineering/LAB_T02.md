# LAB-T02：可信 ARM64 镜像发布与 OrbStack 按摘要部署

日期：2026-10-14。**LAB-02/03/04 已在 GitHub Actions + GHCR + 本机 OrbStack 实际验证 PASS**。源提交和摘要见下表；不是生产部署。首次配置交付时 NOT RUN 的历史状态已由实际执行证据更新。

## 可信云端发布

`.github/workflows/lab-publish.yml` 只由主业务 CI 的 `workflow_run completed` 触发：只读 gate job 从 API 复核同仓库、master、push、指定 CI workflow 路径/ID、当前 master SHA 与唯一 validate job 全部成功。没有 PR head checkout、PR artifact 下载或共享构建缓存。publish job 再核对一次状态；只有它拥有短期 `packages:write`，没有 Mac/SSH/生产凭据。

采用官方支持的 [ubuntu-24.04-arm](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) 原生 Runner，显式 linux/arm64 构建并启动健康/故障两种镜像烟测。固定 package 为 `ghcr.io/noname4me/enterprise-app-marketplace-lab`；源 SHA 是实际 checkout 的提交，镜像 label 与 /version 一致。只发布 SHA-healthy / SHA-unhealthy 标签，不使用 latest 作为身份。记录每个不可变 digest，上传 `lab-release` JSON artifact（保存30天），并写入 run summary。

首次包默认可能 private；[官方 GHCR 文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) 指明公开镜像可匿名拉取。本实验只含公开仓库的合成测试服务，可选择 public 后匿名拉取；不为方便而扩大本地 OAuth/PAT 权限，不保存 registry 密钥到仓库。需核对实际包可见性、源码关联与访问结果再报告 PASS。

## 受限本机部署

`node lab/deploy.mjs <发布run-id> healthy|unhealthy`：只接受固定仓库的成功发布 run，下载其官方 artifact，复核同 SHA 的 master push CI；拒绝 PR/fork/失败/缺失检查、任意仓库、可变标签、非ARM64或伪造发布身份。

使用独立 Compose project `marketplace-lab-release` 和 `127.0.0.1:3382`，不接数据库、不挂卷/宿主 socket，非root、只读、drop ALL、64MiB/0.5CPU、日志滚动。部署/状态/停止入口均校验 Apple Silicon macOS、OrbStack context 与本地 Unix socket，拒绝远程 Docker、DOCKER_HOST 覆盖。单实例本机锁阻止并发部署；若上次进程被强制终止造成锁残留，先检查实际容器与进程再移除本人锁。状态回执保存在 Git 忽略的 `.lab-release-records/`（0600），不含登录凭据。

拉取、架构、镜像用户与源码label核对发生在替换旧容器**之前**：拉取失败或磁盘不足不停止旧版。健康200与/version提交、环境、faultMode再核对。故障演练必须先有健康旧版；unhealthy 镜像实际进入部署，Compose 健康等待失败后恢复旧digest并验证旧版200及版本。原失败保留非零退出（回滚成功=1，回滚失败=2），不能把失败冒充部署成功。无旧版的失败部署停止本人项目，不声称成功回滚。

仅为手动单机演练，替换/回退有短暂中断；不能证明零停机或生产容灾。停止命令仅删除本人项目的容器/网络，无数据库和卷，镜像回滚不撤销任何数据库迁移。

## 复现指令（发布成功且包可访问后）

```sh
gh run list --workflow lab-publish.yml --limit 5
node lab/deploy.mjs <成功发布run-id> healthy
curl --fail http://127.0.0.1:3382/version
node lab/deploy.mjs <相同发布run-id> unhealthy # 预期退出1，回到旧健康摘要
node lab/deploy.mjs status
node lab/deploy.mjs stop
```

## 已执行的门禁前置

[PR #23](https://github.com/NoName4Me/enterprise-app-marketplace/pull/23) 的关键业务负例 [CI](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38507719481) 故意失败后，真实合并请求返回 HTTP405（validate failing），PR关闭未合并。实际 API 确认管理员不可绕过、检查来源限定 GitHub Actions。GATE-04 PASS，详见 [P0-T02](P0_T02.md)。

发布拒绝策略的真实单元负例包括 PR、fork、失败/未结束 run、旧SHA、错workflow/检查、摘要/仓库/架构不符；CI 继续执行门户全量 lint/typecheck/unit/DB/E2E/build/container smoke。真实云端/本机证据见下方。


## 2026-10-14 真实发布与部署证据

| 对象 | 身份 / 结果 |
| --- | --- |
| 配置交付 PR | [#24](https://github.com/NoName4Me/enterprise-app-marketplace/pull/24)，PR最新源码CI [38508780067](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38508780067) PASS；正常Squash合并，无管理员绕过 |
| 被发布源码 | `2c8e2fefc6a82a38e24a962b127b8f29223596af`（#24合并提交） |
| master 全量CI | [38509102112](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38509102112) PASS，包含管理员、DB、lint/typecheck/unit、LAB、E2E、构建与生产容器smoke |
| ARM64 发布 run | [38509341045](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38509341045) PASS，trusted-ci/publish 两个job均通过；publish原生ubuntu-24.04-arm，逐镜像 smoke |
| 包可见性与源码 | [实际包页面](https://github.com/NoName4Me/enterprise-app-marketplace/pkgs/container/enterprise-app-marketplace-lab) 显示Public，关联本仓库；设置页确认继承源仓库权限，只有本仓库获得Actions访问（Admin），无额外Codespaces仓库；未扩展本机Token权限 |
| 健康摘要 | `sha256:6f110220967cc71829f6210d222151e0a7a904f5d5742d0ed7819f14fd2f655e` |
| 故障摘要 | `sha256:2410a8f8cf2c1275983b3f9579648a616a7dc74aa4215135e62e5d3ffd91e839` |
| 镜像平台 | 两者均 linux/arm64，标签SHA、OCI revision、/version均对应上述源码；两种构建只改变固定健康参数，非两个不同源码提交 |
| 匿名拉取 | 本机使用临时空Docker config（无registry认证），连接现有OrbStack本地Unix socket，按两个摘要实际pull均退出0 |
| 首次健康部署 | 北京时间12:04:07–12:04:10，`node lab/deploy.mjs 38509341045 healthy` 退出0，结果deployed |
| 故障及回退复测 | 北京时间12:07:21–12:07:31，unhealthy摘要实际部署后容器unhealthy；Compose非零，恢复原健康摘要并HTTP复核；命令退出1（预期），result=rolled_back，restoredImage=上述健康摘要 |
| 服务响应 | /version返回源SHA、local-lab、faultMode=healthy；/health200；实际观察过故障503→旧版200以及替换期间短暂断连 |
| 运行边界 | image@digest、user=node、readonly=true、内存上限67108864字节、仅127.0.0.1:3382；回退后实测12.97MiB/64MiB，不访问数据库 |

### 首次失败与修复（不掩盖失败记录）

首次故障演练在12:05:08–12:05:18已恢复健康容器，但部署进程单次HTTP验证收到 `fetch failed`，记为rollback_failed并退出2；并行独立监测与随后Docker/HTTP检查均显示旧摘要恢复200。该轮脚本验收为FAIL。修复为关闭旧keep-alive连接复用，并对传输失败做最多5次有超时的重试；版本/环境/健康不符立即失败，不靠重试掩盖错误版本。新增真实HTTP负例测试：首连接中断后恢复、错误版本拒绝、持续断连有限次失败。修复后完整故障演练再次运行，result=rolled_back、退出1，才标记LAB-04 PASS。

本机源记录保留在 `.lab-release-records/`：健康部署、首次退出2、修复后的退出1、故障503→200观察和负例回执均为实际输出，未提交凭据或本机路径敏感日志。部署工具的限定本机保护和HTTP重试在本证据补充PR交付，发布服务镜像源码仍为上表精确SHA。

### 拒绝与未覆盖边界

- 实际 `DOCKER_HOST=tcp://127.0.0.1:1` 覆盖被拒绝（退出1），不调用远程Docker、不修改容器。
- 实际将失败PR run 38507719481传入部署入口被拒绝（退出1）；健康容器ID/摘要不变。
- 固定包不存在的全零摘要真实Docker pull非零；健康容器ID/摘要不变。此项验证pull失败不影响运行容器，不伪称已通过受信manifest发布了该不存在摘要。
- 没有强制制造真实磁盘耗尽或永久回滚失败；这些破坏场景NOT RUN。脚本有拉取前空间检查、拉取失败停止替换、回滚失败退出2并留回执；不得把条件处理代码冒充磁盘/容灾实测。
- artifact保存30天，到期后的run不能继续用此入口下载发布记录；GHCR历史镜像需另行制定保留策略，本批不删除已有版本。
- 最终实验容器/网络在采证后停止；保留镜像与本地回执供复现。原有Postgres/MySQL/其他服务未停止，实验不证明生产高可用或零停机。
