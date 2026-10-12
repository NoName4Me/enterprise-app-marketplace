# MVP-1 验收标准与测试用例（阶段 0 交付）

状态：**实施前验收规范**，尚未执行。适用首个垂直闭环，不表示第一阶段全部功能已经交付。

## 1. 测试对象与数据夹具

独立测试 PostgreSQL 数据库，每轮测试重建或事务回滚；浏览器与 API 使用同一测试环境，绝不指向生产库。

| 测试用户 | 权限 | 初始状态 |
| --- | --- | --- |
| `alice@example.test` | 普通员工，active | 无创建/审批权限 |
| `bob@example.test` | active，canCreateApp | 应用创建者 |
| `carol@example.test` | active，canCreateApp | 第二位创建者，用于越权测试 |
| `admin@example.test` | active，isAdmin，不是申请人 | 审批与用户管理 |
| `disabled@example.test` | disabled | 不允许操作 |

测试应用使用 `https://example.test/...`（不会真实请求的占位目标 URL），不要提交真实公司内部服务地址。示例：

- **A-1 报表中心**：Bob 创建；草稿名称 `报表中心`、地址 `https://example.test/reports-v1`。
- **A-2 内部协作工具**：Carol 创建；独立草稿，用于越权检查。
- **A-3 旧版公开应用**：已有 APPROVED r1，`LISTED`，地址 `https://example.test/legacy`；仅供后续版本复审用例。
- **A-4 受拒应用**：已有 REJECTED 申请，无已发布版本。

账号测试凭据由测试启动脚本临时生成，在测试环境配置，不写入真实仓库/CI 日志。

## 2. 验收用例（Given / When / Then）

### 2.1 认证与权限

| ID | Given | When | Then | 验证层级 |
| --- | --- | --- | --- | --- |
| AUTH-01 | Alice 有有效账号 | 使用正确凭据登录 | 返回有效 session；可以访问市场 | E2E/API |
| AUTH-02 | 无 session | 访问市场 UI 或 GET /api/apps | 跳转登录或 401；响应体无业务数据 | E2E/API |
| AUTH-03 | Alice 为普通员工 | 构造 POST /api/my/apps 创建应用 | 403；数据库无新增 | API+DB |
| AUTH-04 | Bob 有创建权限 | 创建应用草稿 | 成功；归属 Bob，默认未上架 | E2E/API+DB |
| AUTH-05 | Bob 非 Carol 应用所有者 | 修改或提交 Carol 的应用 ID | 403/404；记录及事件不变 | API+DB |
| AUTH-06 | Bob 有创建权限但非管理员 | 调用审批通过/驳回 API | 403；申请保持 PENDING | API+DB |
| AUTH-07 | 管理员撤销 Bob 创建权限 | Bob 保持原 session，继续创建或提交 | 403；只能查看自己已存历史 | API+DB |
| AUTH-08 | 用户被禁用 | 持旧 session 执行业务读写 | 401/403，不能继续获取市场数据 | API |
| AUTH-09 | 公开注册关闭 | 匿名调用注册接口 | 无法创建用户；无新增用户记录 | API+DB |
| AUTH-10 | 已经存在管理员 | 再运行初始管理员引导 | 安全失败、不重置旧密码 | CLI+DB |
| AUTH-11 | 非管理员 | 调用管理员创建/停用用户或赋权 API | 403；数据库无修改 | API+DB |
| AUTH-12 | 管理员提交了自己的申请 | 尝试自己审批 | 403；待审状态不变（实施假设） | API+DB |

### 2.2 应用发布流程

| ID | Given | When | Then | 验证层级 |
| --- | --- | --- | --- | --- |
| PUB-01 | Bob 有创建权 | 创建完整 Web 应用草稿 | application=UNLISTED，revision=DRAFT，owner=Bob | API+DB |
| PUB-02 | Bob 的草稿字段缺失或 URL 无效 | 提交审核 | 400/422；状态不变，提示字段错误 | API |
| PUB-03 | 完整草稿 | Bob 提交审核 | revision=PENDING，提交时间与事件已持久化 | E2E/API+DB |
| PUB-04 | 待审快照 | Bob 直接请求修改该 revision 内容 | 409/403；待审内容不可变 | API+DB |
| PUB-05 | 待审应用 | Carol 或 Alice 直接读取公开详情 ID | 404；列表和搜索都不包含该应用 | API/E2E |
| PUB-06 | Bob 的 PENDING 请求 | Admin 审核通过 | revision=APPROVED，application=LISTED，published_revision_id 指向该版本 | E2E/API+DB |
| PUB-07 | 审核通过应用 | Alice 搜索名称并进入详情 | 仅展示批准版信息，存在合法外链 | E2E/API |
| PUB-08 | Bob 的 PENDING 请求 | Admin 驳回并输入非空理由 | revision=REJECTED；application 仍未上架；Bob 可见原因 | E2E/API+DB |
| PUB-09 | REJECTED 申请 | Bob 按既有内容创建新 DRAFT，修订后重交 | 旧 REJECTED 历史不可变；新申请获得新 revision id/seq | API+DB |
| PUB-10 | Bob 的 PENDING 请求 | Admin 不输入驳回理由 | 400/422；状态仍为 PENDING | API+DB |
| PUB-11 | 已经 APPROVED 或 REJECTED 的申请 | 重放审核动作 | 409；不重复生成审核事件 | API+DB |
| PUB-12 | 两个管理员并发处理同一待审申请 | 同时通过/驳回 | 恰好一方成功，另一方 409；最终状态唯一且审计一致 | 并发集成 |
| PUB-13 | Bob 已有 DRAFT 或 PENDING | 再创建该应用的新活跃 revision | 409 / 唯一约束阻止并发双活跃版本 | 并发集成 |
| PUB-14 | 发布事务审计写入被模拟为失败 | 管理员审批 | 事务整体回滚：不出现 LISTED 或已批准状态 | 集成+故障注入 |

### 2.3 对外公开数据隔离

| ID | Given | When | Then | 验证层级 |
| --- | --- | --- | --- | --- |
| VIS-01 | 草稿/待审/驳回/未上架四种数据 | Alice 直接 GET 列表、搜索、详情 | 均无未发布内容；详情 404 | API |
| VIS-02 | 已上架 r1 及待审核 r2 | Alice 请求目录、详情、访问链接 | 仅看到 r1 的名称、描述和 URL | API+DB |
| VIS-03 | 已上架 r1 且 r2 被驳回 | Alice 重查目录/详情 | 仍为 r1；review_event 无矛盾 | API+DB |
| VIS-04 | 已上架 r1 且 r2 通过 | Alice 重查目录/详情 | 原子切换到 r2；无字段混用 | API+DB |
| VIS-05 | 应用已下架（阶段 2） | Alice 读取详情或搜索 | 404、不可发现；历史审批仍保留 | 阶段 2 |
| VIS-06 | 公开列表和管理端共享同源数据 | 用户切换 / 带不同 Cookie | 不得返回跨用户缓存的草稿或待审详情 | E2E/API |
| VIS-07 | 用户提交 `javascript:` / `data:` URL | 创建/更新应用草稿、提交 | URL 无法进入已发布链接；最终端点按边界拒绝 | API/UI |

## 3. 第一轮必须通过的闸门

**MVP-1 发布前硬性要求**：

- 上表 AUTH-01～12、PUB-01～12、PUB-14、VIS-01、VIS-06、VIS-07 全部通过；PUB-13 在引入更新草稿前至少由 DB 唯一索引检查证明。
- 构建、TypeScript strict、Lint、单元测试、PostgreSQL 集成测试、Playwright 冒烟测试在干净环境通过。
- 自动化 CI 或手动报告必须附：执行命令、成功/失败数量、测试环境、失败的根因、剩余已知风险和证据链接。**不能仅凭 AI 输出的“已完成”验收**。
- 未实现的阶段 2 验收用例必须标注为未执行，不能算通过。
- 生产密钥不能进入仓库，管理员初始化步骤可安全复现。

## 4. 独立验收原则

- 接口直接发起请求（不依赖客户端 UI），分别验证授权拒绝与数据库副作用。
- 测试数据来自本验收文档的业务规则，不要求与实现函数命名一致。
- 对审批并发、审计回滚、发布快照隔离，使用真实 PostgreSQL 测试；不要只 Mock ORM。
- 通过 UI 验证表单操作和用户反馈，API + DB 验证状态不变量。
- 在 CI 首次运行前，所有结果标记为 **NOT RUN**，拒绝伪造绿灯。
