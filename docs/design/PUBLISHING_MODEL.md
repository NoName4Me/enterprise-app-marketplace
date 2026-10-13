# 应用、版本与审批状态模型（阶段 0 交付）

状态：MVP-1 领域模型设计基线；后续更新复审无需推翻当前主结构。

## 1. 首要建模原则

**应用（逻辑实体） ≠ 应用信息版本（登记快照） ≠ 审核行为。**

同一个应用只有一个长期稳定 `application.id`，每一次申请审核的是某个**不可变快照**。普通员工只能看到当前已经正式发布的快照；新版本的编辑/审批绝不覆盖该快照。

### 实体及关键字段（逻辑模型，非最终 SQL）

```text
users / session / credential       <- Better Auth owns auth tables
  users: id, email, displayName, disabled, isAdmin, canCreateApp, ...
applications
  id, owner_user_id, published_revision_id nullable,
  listing_status [UNLISTED | LISTED], created_at, updated_at
app_revisions
  id, app_id, seq,
  status [DRAFT | PENDING | APPROVED | REJECTED],
  name, summary, description, icon_ref, category, target_url,
  created_by, submitted_at, reviewed_by nullable, reviewed_at nullable,
  rejection_reason nullable, created_at
review_events
  id, app_id, revision_id, actor_user_id, action, occurred_at,
  reason nullable, request_id
```

- `app_revisions` 中 `DRAFT` 可编辑，`PENDING/APPROVED/REJECTED` **正文不可变**；状态转换和审计字段由受控事务维护。
- `APPROVED` 表示一个版本曾通过审核，不等于其始终在市场展示；只有 `applications.published_revision_id` 指向的版本是对外生效版本。
- `listing_status=UNLISTED` 将来支持下架；**新应用未审核时即使已有 application 行，也不能被当作上架内容读出**。
- 首轮图标可以是受控内置图标/HTTPS URL，后续独立建设上传存储。

### 必要数据库约束

- 所有主外键明确；`app_revisions(app_id, seq)` 唯一，`seq` 在每个 app 下递增。
- 一个应用最多一个正在编辑或审核的版本：PostgreSQL 建立 `UNIQUE(app_id) WHERE status IN ('DRAFT','PENDING')` 的局部唯一索引（如业务需要允许审核中另存草稿，则另开 ADR，不在本轮支持）。
- `published_revision_id` 应指向**同一应用下**已批准的版本；仅外键不足以保障跨表的批准条件，需在领域事务中校验（必要时复合 FK 或数据库触发器）。
- 发布成功同时完成版本状态更新、应用指针切换和审计写入，事务级原子性。
- 关键并发更新使用 `UPDATE ... WHERE status = 'PENDING'` 检查影响行数或行锁；应用版本号/条件更新防止覆盖其他请求。
- 不直接接受来自客户端的 `status`、`owner_user_id`、`published_revision_id`、`reviewed_by` 等值。

## 2. 状态转换表

| 当前状态 | 事件 | 前置条件 | 目标状态与副作用 |
| --- | --- | --- | --- |
| 无 | 创建应用 | 活跃用户且有 `canCreateApp` | 新建 `applications(UNLISTED)` + `app_revisions(DRAFT)` |
| DRAFT | 保存编辑 | 所有者且有创建权 | 仍为 DRAFT；不可影响线上 |
| DRAFT | 提交审核 | 所有者且有创建权；字段合法 | 版本转 PENDING，记录 submitted_at 和审计 |
| PENDING | 审核通过 | 活跃管理员、非申请人、当前仍待审 | 版本转 APPROVED，指针切换为本版本，应用 LISTED，审计原子写入 |
| PENDING | 审核驳回 | 同上且有非空原因 | 版本转 REJECTED；指针和上下架状态不变，审计 |
| REJECTED | 重新修改 | 所有者且有创建权 | 从驳回快照复制新 DRAFT（新 revision id/seq）；驳回历史保持不可变 |
| APPROVED | 创建更新草稿 | 所有者且有创建权；当前无 DRAFT/PENDING | 复制当前公开版生成新 DRAFT；公开指针不变 |
| LISTED + PENDING 更新 | 审核通过 | 符合审批条件 | 原子切换公开版指针；旧版保留历史 |
| LISTED + PENDING 更新 | 审核驳回 | 符合审批条件 | 旧版继续对外生效 |
| LISTED | 管理员下架 | 后续功能 | listing_status=UNLISTED，保留公开版本指针和历史 |

重要说明：**首轮工程仅实现新应用草稿、提交、通过/驳回、驳回重提和公开读取**。已上架更新复审本阶段先定义正确模型，阶段 2 再实现交互。

### 状态不变量

1. `published_revision_id` 指向的内容，在管理员审批通过前绝不变更。
2. 一个应用可以是 LISTED 且存在待审新版本；普通员工只能看到旧的 APPROVED 版本。
3. PENDING 快照不允许修改正文；驳回并不删除申请记录。
4. `review_events` 写入与对应成功状态变化同事务提交；失败不产生“已批准”假日志。
5. 被下架应用无法通过普通员工的列表、搜索或详情获取；所有公开读取路径使用统一谓词。
6. 单个申请只可能终结为 APPROVED 或 REJECTED 其中之一；不能二次终结。
7. 初次批准失败不能出现无版本指针但处于 LISTED 的半成功记录。

## 3. 核心用例及并发处理

**创建与提交**：事务内保存完整 DRAFT → 逐项验证 URL、名称等 → 条件更新 DRAFT→PENDING，并提交审计。业务输入不允许操控业务状态。

**审核通过**：事务中锁定对应申请与应用 → 校验状态、管理员权限及非本人申请 → 更新版本为 APPROVED → 原子切换 `published_revision_id` 并置 LISTED → 写 review_event → 提交；失败时回滚全部数据。

**审核驳回**：同理锁定 PENDING，检查原因非空，写 REJECTED+事件，不更改已发布指针。

**公开读取**：`applications.listing_status='LISTED'` 且 `published_revision_id IS NOT NULL` 且 join 得到指向的批准版。对外响应明确白名单投影字段，不返回创建者凭据、审核内部备注或草稿内容。

**同时审核**：两位管理员同时审批同一请求时，只允许第一笔提交生效；第二笔返回冲突，不允许“先通过后驳回”覆盖历史，也不创建重复事件。

## 4. 缩小首版复杂度的决定（实施假设）

- 单所有者，无多人协作；
- 审批期间暂不支持撤回申请；
- 一应用同时最多一个可编辑或待审快照；
- 分类先用受控枚举/最小表，复杂分类管理延后；
- 不预设应用商店上架等于目标应用已获安全认证；只审核登记内容与业务上架许可。

如这些假设妨碍已确认的产品决策，必须先报告并提出调整建议，而不是静默改变行为。
