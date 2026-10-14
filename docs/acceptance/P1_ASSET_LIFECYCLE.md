# P1-T01资产与生命周期验收用例

日期：2026-10-14；对应[设计](../design/P1_ASSET_LIFECYCLE.md)。状态按验证层次记录，P1-A部分已本地实测；具体覆盖和NOT RUN见[交付记录](../engineering/P1_ASSET_DELIVERY.md)。A/B/C已实现并有实际分层验证，MIG-04受限只读回退已验证，完整可写历史版本回退仍NOT RUN，整体P1门槛尚未完全闭环。原用例表保留验收要求，不代表各层全部通过。

## 1. 测试夹具与执行层次

隔离PostgreSQL fixture，禁止连接开发/生产库。使用alice（普通员工）、bob（owner+创建权）、carol（其他owner）、reviewer（admin非owner）、disabled（停用）、readonly-owner（owner撤权），均为example.test账号。另测管理员作为owner与首登未改密账号。

App A含旧批准r1、新待审r2；App B属于carol；另有UNLISTED/DRAFT、REJECTED、下架但有批准指针的历史应用。组件portal/api，环境lab-test/production，显式关联而非自动交叉生成。外部引用使用公开演示仓库或合成值，不放公司地址、真实员工信息或Token。

单元测试验证字段白名单、生命周期转换和typed GitHub引用；API+真实DB验证权限/复合FK/事务；并发和失败注入必须真实执行；浏览器验证可读界面与冲突处理，不能仅看按钮存在与否。

## 2. 资产及私有读取（P1-T01-A）

| ID | Given / When | Then | 验证 |
| --- | --- | --- | --- |
| ASSET-01 | bob给A登记portal/api及两个环境，绑定其中三个组合 | 正确保存多组件/多环境；未登记的第四组合不存在；无CI引用也能登记 | API+DB |
| ASSET-02 | bob将A组件绑定B环境，或给A引用传B的binding ID | API404；数据库复合FK独立拒绝跨应用写入；资源/根版本/事件不变 | API+DB |
| ASSET-03 | 两请求以同一expectedVersion保存不同资产 | 恰好一笔成功，另一409；根版本只加1，一条成功审计 | 并发DB |
| ASSET-04 | 传actor/owner/publishedRevision/role/assetVersion覆盖值、未知字段、超长文本 | 422；身份/公开指针/状态不变；expectedVersion只作比较 | 单元+API |
| ASSET-05 | 同应用重建重复key/绑定/引用（含binding或workflow为NULL） | 唯一性拒绝；不同应用可有相同key；归档不释放历史key | API+DB |
| ASSET-06 | 活跃关联尚存时归档父对象；父归档时恢复子关联 | 409；按引用→绑定→父对象顺序可归档；历史ID/审计保留 | API+DB |
| ASSET-07 | 登记仓库和workflow引用，不连接任何采集器 | 只显示“已登记，未验证连接”；采集时间null，健康/部署未接入；不请求任意URL | 单元+API+E2E |
| ASSET-08 | 写入审计触发器强制失败 | 对象变化、根版本及事件全部回滚；返回失败，非伪成功 | 故障注入DB |

### 权限与公开隔离（P1-02）

| ID | Given / When | Then | 验证 |
| --- | --- | --- | --- |
| SEC-01 | 无session、disabled或未改密用户读取/写资产 | 401/403；无私有响应、无数据库副作用 | API |
| SEC-02 | alice/carol直连A的资产、环境、引用、审计、预检及写端点 | 404；不泄漏资源是否存在、GitHub链接、数量或错误中的备注 | API |
| SEC-03 | bob创建权撤销但session仍有效 | 可读A历史，资产/生命周期写403；再次请求实时检查数据库权限；撤权与新写入竞态按账号锁串行化 | API+DB |
| SEC-04 | 非owner管理员读取A及直接PATCH资产；管理员owner无创建权编辑 | 治理读允许；任意代编辑拒绝；治理恢复/移交仅专用入口 | API+DB |
| SEC-05 | A登记私有资产后，alice读市场列表/详情/收藏/搜索/推荐；r2待审或驳回 | 仍只有r1批准投影，不含资产/生命周期/团队/账号ID；旧公开地址不变 | API+E2E |
| SEC-06 | 依次切换owner、admin、普通员工Cookie请求同URL | private/no-store；不复用前一角色私有数据或错误缓存 | API+E2E |
| SEC-07 | 伪造仓库URL为javascript/data/内网地址、路径穿越、凭据参数或Token字段 | 422；只有固定GitHub深链；无后端任意fetch、无凭据入库 | 单元+API |

## 3. 生命周期、退役、移交（P1-T01-B / P1-03）

| ID | Given / When | Then | 验证 |
| --- | --- | --- | --- |
| LIFE-01 | owner对UNKNOWN→PILOT→ACTIVE→DEPRECATED合法转换 | 只改治理状态/版本/审计；不会批准快照、上架、部署或变健康 | 单元+API+DB |
| LIFE-02 | DEPRECATED且LISTED，或存在DRAFT/PENDING，或有未归档资产时请求退役 | 409且有明确私有阻塞项；不自动下架、驳回、删申请或删外部资源 | API+DB |
| LIFE-03 | 预检时条件满足，随后增加绑定/引用再执行旧请求 | stale version409；即使预检通过也锁内重查，无退役事件 | 并发DB |
| LIFE-04 | DEPRECATED/UNLISTED、无活动申请、资产全归档；提交理由及人工影响声明 | RETIRED，指针与历史保留；声明带actor/服务端时间；外部观测仍UNKNOWN | API+DB |
| LIFE-05 | RETIRED后从旧草稿/提交/批准/管理员relist入口发请求，或直接将listing改LISTED | 服务端拒绝；数据库CHECK拒绝违规上市；不会通过旧入口解除冻结 | API+DB |
| LIFE-06 | reviewer恢复RETIRED到DEPRECATED | 仍UNLISTED，子资产仍归档；普通owner无治理特权恢复403；内容变更仍需复审 | API+DB |
| LIFE-07 | 同时退役与批准/重新上架，或同时退役与新增关联 | 遵循相同application锁顺序；恰好一个一致结果，禁止RETIRED+LISTED；不死锁、不写假审计 | 并发DB |
| LIFE-08 | 模拟生命周期/移交审计失败或重复动作 | 完整回滚；重复/旧版本409，无第二条成功事件 | 故障注入DB |
| OWNER-01 | 管理员移交A给活跃且有创建权的carol，无PENDING（分别覆盖无草稿及有DRAFT） | owner更新、继承责任/私有可见性同时转移；bob持旧session直读A404；历史created_by不变；新owner/原创建者均不能自批移交草稿，第三方reviewer可审 | API+DB |
| OWNER-02 | 普通owner移交、目标停用/未改密/无创建权、存在PENDING、旧expectedVersion | 403/409/422；不得绕过当前申请归属/管理员自批保护 | API+DB |
| OWNER-03 | 移交与原owner写入并发 | 按锁/版本决定唯一结果；转移成功后旧owner不能再次写；无跨owner成功事件 | 并发DB |

## 4. 迁移与回退

| ID | Given / When | Then | 验证 |
| --- | --- | --- | --- |
| MIG-01 | 从8c5a06f schema及各历史状态应用执行前向迁移 | 应用/owner/公开指针/快照/事件/社区数据完整；全为UNKNOWN；零自动组件/环境 | 迁移DB |
| MIG-02 | 迁移前后同一员工请求所有公开接口 | 投影与访问地址保持一致；不把上架推断为ACTIVE或健康 | API+DB |
| MIG-03 | 迁移执行失败或约束存在脏数据 | 停止并输出失败，不删除审批/历史数据“修绿”；恢复流程可重复 | 迁移故障注入 |
| MIG-04 | P1-A/B新增表存在，回退到约定的兼容代码版本 | 新数据保留；生命周期冻结防护仍有效；数据库备份恢复另行演练，不混作镜像回滚 | 回退演练 |

## 5. UI与交付门槛（P1-T01-C）

| ID | 场景 | 结果 |
| --- | --- | --- |
| UI-01 | owner从我的应用进入资产区登记两组件、两环境、明确绑定与引用 | 保存后显示真实数据，无自动生成prod、无Mock健康绿灯 |
| UI-02 | 普通员工看公开详情、owner撤权后看私有详情 | 员工无私有分区；撤权owner有只读说明；API独立拒绝写入 |
| UI-03 | 旧版本保存冲突、退役预检失效、管理员移交后旧页面再保存 | 明确提示重新读取；不静默覆盖，不靠隐藏按钮完成授权 |
| UI-04 | 管理员治理视图恢复/移交、owner退役影响确认 | 有理由/影响来源与审计；说明不会自动关停目标服务或改公开登记 |

每批需附新SHA、实际lint/typecheck/unit/DB/E2E/build/container结果与失败记录。ASSET/SEC/LIFE/OWNER/MIG/UI各组在对应实现后才从NOT RUN更新为PASS；全部实现前，NEXT_PHASE_GATES的P1-01/02/03不得勾选。仅设计文档检查和现有回归通过，不等于这些新用例通过。
