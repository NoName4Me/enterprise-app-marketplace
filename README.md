# 企业应用与软件交付协作平台

Next.js + TypeScript + PostgreSQL/Drizzle + Better Auth。已有员工应用市场、上架审核、收藏评价讨论；P1 应用资产、组件/环境、生命周期、维护工作台已合并 PR #26。真正 AI 应用发现、需求自动交付与智能运维尚未开发，非生产版本。

产品围绕员工 **发现应用 → 申请使用或提出需求 → 开发交付 → 持续维护** 的业务闭环协作，连接维护者、运维人员和 AI，而非重建多套专业工具。

下一主线：**P2 应用使用申请 → 审批 → 人工开通记录与结果反馈**。使用申请、需求广场、真正 AI 发现、开发者中心均保留；Agent/工作流市场和独立论坛暂缓。Mac mini M4 + OrbStack 与 GitHub Actions/GHCR 真实实验链路已打通。

## 活跃文档

[PRODUCT](docs/PRODUCT.md) · [ROADMAP](docs/ROADMAP.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [ASSETS](docs/ASSETS.md) · [DEVELOPMENT](docs/DEVELOPMENT.md) · [QUALITY](docs/QUALITY.md) · [ADR-001](docs/decisions/ADR-001-technical-baseline.md) · [ADR-002](docs/decisions/ADR-002-platform-evolution.md) · [AGENTS](AGENTS.md)

旧任务设计/验收/交付记录通过 Git 历史、Issue、PR、Actions 追溯，避免多个文档维护冲突信息。

## 本地启动

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
docker compose up -d
pnpm dev
```

已有 OrbStack/PostgreSQL 数据不得清除；仅在检查 DATABASE_URL 后迁移或引导管理员。http://localhost:3000/login 。普通功能优先真实主流程，不强制新增自动化测试；PR 轻量 CI，master 全量回归。GHCR 实验发布改为手动、以受信 master 完整 CI 为前提。

公开仓库尚无开源许可证；不提交员工数据、内部敏感资料和密钥。