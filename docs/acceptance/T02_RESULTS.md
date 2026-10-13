# T02 服务端验收覆盖记录（2026-10-13）

该表只列已实际执行的 **HTTP/API + PostgreSQL** 检查；浏览器 E2E **NOT RUN**。
CI：[T02 GitHub Actions](https://github.com/NoName4Me/enterprise-app-marketplace/actions/runs/38356442444)。

| ID（MVP1 对应） | 测试目标 | 结果 | 证据 |
| --- | --- | --- | --- |
| AUTH-02/03 | 未登录无法调用目录，普通员工不能创建应用 | PASS (API) | publishing.integration.test.ts |
| AUTH-05 | 非所有者不可读取/修改他人草稿 | PASS (API/DB) | publishing.integration.test.ts |
| AUTH-06/07 | 无管理员权限不能审批；创建权撤销立刻生效 | PASS (API/DB) | publishing.integration.test.ts |
| AUTH-12 | 有创建权限的管理员不能自审 | PASS (API/DB) | publishing.integration.test.ts |
| PUB-01/02/03/04 | 草稿、缺字段拒绝提交、提交审核、待审不可编辑 | PASS (API/DB) | publishing.integration.test.ts |
| PUB-05/06/07 | 未审批不可公开，批准后可查询，字段来自已批准版 | PASS (API/DB) | publishing.integration.test.ts |
| PUB-08/09/10/11 | 驳回理由校验、驳回重提、重复审批冲突 | PASS (API/DB) | publishing.integration.test.ts |
| PUB-12 | 两管理员并发同一审核，仅一次终结事件 | PASS (PostgreSQL) | publishing.integration.test.ts |
| PUB-13 | 活动申请的 DB partial unique 约束 + 用例冲突 | PASS (DB + API) | 版本化 migration + publishing.integration.test.ts |
| PUB-14 | 人为强制审核事件 INSERT 抛错时原子回滚 | PASS (PostgreSQL trigger 故障注入) | publishing.integration.test.ts |
| VIS-01/02/03/04 | 公开仅读已上架版本；更新待审旧版不变；更新通过才切换 | PASS (API/DB) | publishing.integration.test.ts |
| VIS-07 | javascript:/data:/http: URL 不得登记 | PASS (API) | publishing.integration.test.ts |
| AUTH-01/08/09/10/11 | 基础认证/管理员操作 | 参见 T01 记录 | auth.integration.test.ts |
| VIS-05 | 下架后不可见（阶段 2） | NOT RUN | 尚未实现下架 |
| VIS-06 | 真实浏览器跨用户缓存/权限验证 | NOT RUN | 下一阶段 Playwright |
| 全页面 E2E | 员工登记→审核→市场浏览 | NOT RUN | T03/T04 实现页面后执行 |

**结论**：T02 的领域行为已有自动化数据库层证据；但这不是第一阶段整体产品验收，更不是生产上线审批。
