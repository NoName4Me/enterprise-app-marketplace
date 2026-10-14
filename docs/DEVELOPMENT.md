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