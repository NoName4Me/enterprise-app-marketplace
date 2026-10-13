# T02 实现与验证记录

状态：**实现已提交到独立分支，待 CI 验证**。本任务交付 API/领域层及数据库测试，尚无面向员工的完整上架 UI。

## 业务模型与接口

- 一个应用 `applications` + 多次不可变申请 `app_revisions` + 审核事件 `review_events`。
- `listingStatus` 与 `publishedRevisionId` 仅由审核事务切换；PENDING 不影响旧版。
- 支持 DRAFT 保存、提交 PENDING、通过/驳回、驳回后新建 revision、更新重新审核；审计与状态修改同一 PostgreSQL 事务。
- 一个应用最多一个 DRAFT/PENDING 由 PostgreSQL partial unique index 约束。
- 服务端每次请求查询 Session 和账号权限；只使用 Session 的用户 ID，不接受客户端传入 owner 或 status。
- `GET /api/apps?q=...`、`GET /api/apps/:id` 仅返回已上架版本的白名单字段。

## 暴露的 HTTP API

| 动作 | 路由 | 权限 |
| --- | --- | --- |
| 创建应用草稿 | POST /api/my/apps | canCreateApp |
| 我的应用 | GET /api/my/apps | active employee |
| 我的详情/修改草稿 | GET/PATCH /api/my/apps/:id | owner (PATCH needs creator permission) |
| 新建一份后续草稿 | POST /api/my/apps/:id/draft | owner + creator permission，旧申请须已终结 |
| 提交审核 | POST /api/my/apps/:id/submit | owner + creator permission |
| 待审列表 | GET /api/admin/reviews | admin |
| 审批通过/驳回 | POST /api/admin/reviews/:revisionId/approve 或 /reject | admin，不能自审 |
| 员工目录/公开详情 | GET /api/apps?q=...、GET /api/apps/:id | 登录用户，只看已发布 |

客户端草稿内容字段：name、summary、description、category（office/analytics/development/collaboration/other）、targetUrl（HTTPS）、iconRef（HTTPS 可选）。提交需至少 name、summary 和 targetUrl 非空。

## 重要未完成/限制

- 尚未构建完整上架、审核、目录的页面 UI；由 T03/T04 完成。
- 未做下架、社区和 AI 发现；首轮不在该任务实现。
- `published_revision_id` 当前由事务校验正确性，数据库级“属于同一 app 且状态已批准”的跨表约束仍需后续评审；公开读取双重校验确保不泄露未批准版本。
- 第一版以 PostgreSQL 事务控制审核竞争；仍须 CI 真实证明并发测试。
- 尚未完成产品上线安全审计、后端最后管理员保护及浏览器 E2E（Issue #5）。

## 验收证据

待 CI 执行后补充成功与失败记录。未执行项不得标为 PASS。
