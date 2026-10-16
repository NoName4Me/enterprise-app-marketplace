# OrbStack 隔离实验环境

统一环境与发布说明：[docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)。实验不使用已有开发数据库，不删除原有 OrbStack 卷。

```sh
node lab/init-env.mjs
LAB_REVISION=$(git rev-parse HEAD) sh lab/run.sh up
sh lab/run.sh status
sh lab/run.sh fault    # 预期异常
sh lab/run.sh recover
sh lab/run.sh stop     # 保留实验数据卷
```

历史本机/ARM64 摘要部署与回滚证据见 PR #17、#24。以后 GHCR 发布从当前 master 完整成功 CI 获取 Run ID，再**手动**触发 `lab-publish.yml`，Mac `deploy.mjs` 仍验证受信发布、digest 和本机 OrbStack。不能把实验结果声称为生产验收。