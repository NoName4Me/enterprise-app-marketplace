# T05 容器交付与发布检查

状态：**CI Docker 构建与真实容器烟测 PASS；生产部署 NOT RUN**。

## 运行模型
Next.js standalone Node 单体，PostgreSQL 独立运行；版本化迁移必须由发布流程单独执行，应用启动不自动执行迁移。
多阶段 Dockerfile 仅将 standalone 及静态构建产物复制到非 root 的 Node 22 运行镜像，不包含 Git、密钥或测试文件。

## 本地容器演示
先使用 Docker Compose 启动独立 PostgreSQL，复制 .env.example 到 .env 并填入本地高强度 secret。
执行 pnpm install --frozen-lockfile，pnpm db:migrate，以及受控管理员引导：node scripts/bootstrap-admin.mjs --email admin@example.com --name Admin。
然后执行 docker build -t enterprise-app-marketplace:local .。
仅 Linux 示例：docker run --rm --network host --env-file .env -e PORT=3000 -e HOSTNAME=127.0.0.1 enterprise-app-marketplace:local。
在 macOS/Windows 的 Docker Desktop 环境中，不应照搬 host-network；需要显式 Docker 网络与可访问的 PostgreSQL 地址。

## CI/烟测范围
真实 Docker 镜像启动后：GET /api/health 在 PostgreSQL 可用时返回 200 与 status=ok；匿名 GET /api/apps 必须返回 401。
这不等于生产端到端。完整浏览器用户流程已在同一 CI 的 Playwright 测试阶段验证。

## 发布及回退步骤
1. 记录源码 Git SHA 与镜像摘要，检查 CI 和浏览器验收。
2. 配置外部 PostgreSQL、HTTPS/TLS、认证可信 Origin，运行时安全注入数据库与认证密钥。
3. 先验证数据库备份与恢复，再单独评审并执行迁移；不由应用启动自动迁移。
4. 上线后 smoke test：健康、匿名 401、登录、登记、审批、公开访问；异常时回退上一个应用制品。
5. 代码回退不代表数据库迁移回退；破坏性迁移需要独立恢复或向前兼容策略。

## 当前未完成 / 上线阻断
- 首次登录改密、密码重置、最后管理员保护、完整敏感操作审计（Issue #5）。
- 真实企业云账户、DNS/TLS、PostgreSQL 和备份恢复环境；因此尚未进行生产部署。
- Sites 的 Node runtime、外部数据库、密钥与迁移支持尚未通过实测。
- 供应链：基础镜像目前固定 Node 22 主版本，正式上线需按 digest pin 和漏洞扫描策略治理。

## 2026-10-13 CI 证据

- [T05 GitHub Actions：Docker 构建、Chromium E2E 与容器 PostgreSQL 冒烟全部通过](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38360524603)。
- 经测试的容器使用 Node 22 standalone、非 root 运行；连接 PostgreSQL 测试 DB，health 返回 200 和 status=ok，匿名 GET /api/apps 返回 401。
- 这些检查未验证真实企业 DNS/TLS/云平台、正式密钥与生产数据备份。
