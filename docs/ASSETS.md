# P1 应用资产/生命周期：不可破坏的业务边界

基于已合并 PR #26。当前实现的权威是 `src/db/schema.ts`、`src/domain/asset-service.ts`、`src/domain/lifecycle-service.ts` 和迁移；旧 P1 设计与验收文档留在 Git 历史。

- `applications` 是唯一应用身份，当前 `owner_user_id` 单所有者；团队名称不产生团队 ACL，`asset_version` 处理乐观并发。
- Component、Environment、ComponentEnvironment 显式管理组件/环境组合；属于同一应用，由复合 FK 和服务端校验保护；资源归档/恢复需要检查引用与审计。
- ExternalReference 只登记 GitHub repo/workflow，不授予执行权限；P1-02 在私有资产页可按需只读查询 GitHub 最近提交、PR 和 Actions，并显示访问失败与时间，不将引用本身视为已验证连接；无部署/监控数据仍是 `NOT_CONNECTED`，不是健康/部署成功。AssetEvent 与资源状态、版本同一事务。
- 市场审核快照 `app_revisions`、治理生命周期、部署、健康分开；资产编辑不能修改已批准公开指针。

生命周期：`UNKNOWN`、`PILOT`、`ACTIVE`、`DEPRECATED`、`RETIRED`；合法转换以源码 `lifecycle-validation.ts` 为准。退役必须弃用、下架、无待处理登记草稿、无未归档活跃资产/引用；退役仅是门户治理事实，不代表目标服务已下线。管理员专用恢复/移交须单独授权，禁止转移所有权导致提交者自批。

普通员工只读已上架批准投影；私有资产、仓库引用、审计只能 owner/有权限管理员查看。撤销 owner 创建权后历史只读，不能仅凭 admin 身份代其随意编辑。

已有 P1 迁移 `0005`/`0006` 不能修改或擅自重跑破坏旧数据；代码回滚不等于数据库回滚，存在退役状态时不得回退到不理解冻结规则的旧服务继续写。多人维护、跨应用共享、CMDB/真实运行采集以后按实际需求增量设计。