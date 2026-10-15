# 通用托管发布 · 渐进式实现（与 docs/MAC_MINI_SETUP.md 配合）

**当前实现的是 GitOps 渲染与准入边界，不是端到端自动发布。** 只对 HOSTED 应用使用；EXTERNAL 应用始终是访问地址登记。所有操作最终通过 GitHub PR 与 Argo CD，不能让未审核代码直接持有 Mac 本机管理凭据。

## 一次性配置
Argo CD 管理员审查后执行 `kubectl apply -f p4/gitops/hosted/project.yaml`，确保 `ARGOCD_ALLOWED_PROJECTS` 包含 `marketplace-hosted`。安装/网络/Secret 的主入口仍是 `docs/MAC_MINI_SETUP.md`；**不要重跑整台 Mac 的完整 Setup**。

## 创建测试部署清单（目前只读渲染）
平台在 DB 里为每个托管应用预留两个唯一端口 (TEST, PRODUCTION)。Build 必须来自经可信 CI 发布的 **GHCR 不可变 Digest**；不存在可使用的 Digest 时，不能生成虚假的部署版本。

示例（仅生成 YAML，不部署）：

```sh
node scripts/p4-hosted-manifest.mjs \
  22222222-2222-4222-8222-222222222222 \
  11111111-1111-4111-8111-111111111111 \
  TEST 31015 \
  ghcr.io/example/acme@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  example/acme > /tmp/hosted-test.yaml
```

真实部署还需要完整链条：绑定真实 GitHub commit、触发来源仓库的可信 build、验证 GHCR Digest、在 `p4/gitops/hosted/<appId>/<test|production>/` 通过 PR 更新工作负载、Argo Application 注册/同步、NodePort 从指定客户端探测、回写 verifiedAt/READY。**生产必须引用测试已验证的完全相同 Digest，并有独立审核/健康确认**。

当前未完成：自动仓库构建及 GHCR 包权限、生成 GitOps PR 与 Argo Application 注册、Temporal 版本晋级、Kubernetes Service NodePort 从 LAN 可达的实机验证。这里只处理清单生成，不直接调用 `kubectl apply` 部署任意用户仓库。
