# LAB-T02：可信 ARM64 镜像发布与 OrbStack 按摘要部署

日期：2026-10-14。配置已生成、本地代码检查已执行；**GHCR 发布、实际拉取、故障部署与镜像回滚在本 PR 合并前为 NOT RUN**。合并并执行后按实际 SHA/run/digest 补充证据，不能把配置等同完成。

## 可信云端发布

`.github/workflows/lab-publish.yml` 只由主业务 CI 的 `workflow_run completed` 触发：只读 gate job 从 API 复核同仓库、master、push、指定 CI workflow 路径/ID、当前 master SHA 与唯一 validate job 全部成功。没有 PR head checkout、PR artifact 下载或共享构建缓存。publish job 再核对一次状态；只有它拥有短期 `packages:write`，没有 Mac/SSH/生产凭据。

采用官方支持的 [ubuntu-24.04-arm](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) 原生 Runner，显式 linux/arm64 构建并启动健康/故障两种镜像烟测。固定 package 为 `ghcr.io/noname4me/enterprise-app-marketplace-lab`；源 SHA 是实际 checkout 的提交，镜像 label 与 /version 一致。只发布 SHA-healthy / SHA-unhealthy 标签，不使用 latest 作为身份。记录每个不可变 digest，上传 `lab-release` JSON artifact（保存30天），并写入 run summary。

首次包默认可能 private；[官方 GHCR 文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) 指明公开镜像可匿名拉取。本实验只含公开仓库的合成测试服务，可选择 public 后匿名拉取；不为方便而扩大本地 OAuth/PAT 权限，不保存 registry 密钥到仓库。需核对实际包可见性、源码关联与访问结果再报告 PASS。

## 受限本机部署

`node lab/deploy.mjs <发布run-id> healthy|unhealthy`：只接受固定仓库的成功发布 run，下载其官方 artifact，复核同 SHA 的 master push CI；拒绝 PR/fork/失败/缺失检查、任意仓库、可变标签、非ARM64或伪造发布身份。

使用独立 Compose project `marketplace-lab-release` 和 `127.0.0.1:3382`，不接数据库、不挂卷/宿主 socket，非root、只读、drop ALL、64MiB/0.5CPU、日志滚动。单实例本机锁阻止并发部署；若上次进程被强制终止造成锁残留，先检查实际容器与进程再移除本人锁。状态回执保存在 Git 忽略的 `.lab-release-records/`（0600），不含登录凭据。

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

发布拒绝策略的真实单元负例包括 PR、fork、失败/未结束 run、旧SHA、错workflow/检查、摘要/仓库/架构不符；CI 继续执行门户全量 lint/typecheck/unit/DB/E2E/build/container smoke。真实云端/本机证据将在运行完成后追加。
