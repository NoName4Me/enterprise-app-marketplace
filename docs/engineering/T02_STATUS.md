# T02 实现与验证记录

状态：**服务端发布/审核闭环及真实 PostgreSQL 集成测试已完成；正式页面、浏览器 E2E 和生产安全尚未完成。**

## 实现范围

- 三张业务表：`applications` / `app_revisions` / `review_events`，包含外键、版本序号唯一约束、单活动申请局部唯一索引及基本检查约束。
- 新建、编辑草稿；提交 PENDING；管理员通过/驳回（必须说明理由）；驳回后建立新草稿；已上架应用可以新建更新申请。
- 审批状态切换、发布指针和审计事件在**同一 PostgreSQL 事务**中完成。对同一申请的并发审核只能一个成功。
- HTTP API 在服务端从 Session 提取身份，读取数据库实时校验创建/审核权及所有权，不能透传客户端身份、状态和审核人。
- 公共目录只读取 `LISTED` 且指向已批准的正确应用信息快照，不公开 DRAFT/PENDING/REJECTED 的内容，旧版在审核期间继续可见。
- 校验仅允许 HTTPS Web URL、不允许 URL 凭据和危险协议；拦截额外的 owner/status 字段。

## HTTP API

| 请求 | 用途 | 授权 |
| --- | --- | --- |
| POST /api/my/apps | 创建草稿 | 创建权限 |
| GET /api/my/apps | 自己的应用列表 | 登录 |
| GET /api/my/apps/:id | 自己的应用与各版审核结果 | 所有者 |
| PATCH /api/my/apps/:id | 编辑 DRAFT 内容 | 所有者 + 创建权 |
| POST /api/my/apps/:id/submit | 提交审核 | 所有者 + 创建权 |
| POST /api/my/apps/:id/draft | 从终结版本建立下一份草稿 | 所有者 + 创建权 |
| GET /api/admin/reviews | 待审申请队列 | 管理员 |
| POST /api/admin/reviews/:revisionId/approve | 批准申请 | 非申请人的管理员 |
| POST /api/admin/reviews/:revisionId/reject | 驳回申请（JSON: `{"reason":"..." }`） | 非申请人的管理员 |
| GET /api/apps?q= | 名称关键词查询已上架应用 | 登录 |
| GET /api/apps/:id | 公开当前批准版本详情 | 登录 |

创建/修改的 JSON 可用字段：`name`、`summary`、`description`、`category`、`targetUrl`、`iconRef`。分类暂限定 `office/analytics/development/collaboration/other`；提交时 name、summary 和 HTTPS targetUrl 必填。错误使用稳定的 `error` 字段及 401/403/404/409/422 状态码；未知服务器异常返回 500。

## 验证

- [GitHub Actions：T02 真实 PostgreSQL 集成测试 + TypeScript + Lint + Unit + Production Build 全绿](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38356442444)。
- DB 集成测试：**9 passed**（含 T01 账号测试和 T02 审核测试），单元测试：**2 passed**。
- T02 场景逐项证据与未执行项：[T02_RESULTS](../acceptance/T02_RESULTS.md)。
- 过程中的一次 CI 失败是测试夹具 `role` TypeScript 类型过宽，已修正；初次运行发现 SQL 迁移未提交，随后通过隔离 Actions 生成并纳入版本控制。
- 测试只在隔离 GitHub Actions PostgreSQL 中执行，不代表已在真实企业运行环境演练。

## 未完成与风险

- T03/T04 才会实现应用发布、管理员审核与市场浏览的正式 UI 和 Playwright E2E。
- 下架、操作权限审计、真实图标上传、应用分类管理不在本轮范围。
- 公开指针当前由领域事务和公开读取 JOIN 约束，不是跨表复合外键；后续需要专门评审数据库级完整性保护方案。
- 生产账号安全阻断项仍见 [Issue #5](https://github.com/NoName4Me/enterprise-app-marketplace/issues/5)。
- 必须确认生产数据库迁移、数据库备份与环境隔离后才进行部署。
