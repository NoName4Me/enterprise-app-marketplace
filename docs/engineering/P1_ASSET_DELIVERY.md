# P1-T01本地分批交付记录

日期：2026-10-14。基线8c5a06f；本地分支codex/p1-asset-lifecycle-design。用户同意设计后开发，形成完整批次再提PR。全部数据库操作仅针对新建OrbStack容器marketplace-p1-test-db（127.0.0.1:55441 / market_test）及测试自行创建并删除的迁移验证库，未使用已有开发数据库。

## P1-T01-A：资产基础

实现：应用新增asset_version/lifecycle_status UNKNOWN/团队名称；五张私有资产及审计表；组件、环境、显式绑定、GitHub仓库/workflow引用；owner私有读写、admin专用只读、审计版本分页；字段白名单、同源写入、实时账号检查、application→user锁及版本冲突。关系复合FK、NULLS NOT DISTINCT、历史唯一性和归档依赖保证完整性，审计失败事务全部回滚。公开登记与审批代码未改变。

迁移0005由锁定Drizzle生成，旧迁移未改；资产身份不可改写，引用未验证、health/deployment未接入，不调用GitHub或Docker。生命周期动作及页面不在A中开放。

| 实际执行 | 结果 |
| --- | --- |
| `pnpm db:generate`、`pnpm db:migrate` | PASS，仅隔离测试库；旧数据库未迁移 |
| fixture管理员bootstrap与首登改密 | PASS；初次缺CI=true被安全拒绝，添加隔离fixture环境标记后成功，未修改安全防护 |
| `pnpm typecheck`、`pnpm lint`、`pnpm test` | PASS，5文件13项单元测试 |
| `pnpm test:db` | PASS，8文件36项（新增12项资产端点/事务回归及1项迁移测试） |
| 生产构建 `pnpm build` | PASS；隔离工作区当前代码副本 |
| `pnpm test:e2e`，端口3311独立服务 | PASS，1项多角色浏览器流程，含新增真实HTTP资产登记/越权/版本冲突 |
| `git diff --check` | PASS |
| GitHub CI、生产/开发库迁移、资产UI与生命周期验收 | NOT RUN，本地阶段未推送；B/C尚未实现 |
| 容器构建烟测 | NOT RUN，完整批次末执行 |

失败修正：首轮资产测试误选按UUID排序后的其他组件绑定，API正确404；修正fixture选择指定组件绑定。随后构建发现测试数组类型未显式标注，修正后typecheck/build通过。审计失败返回500是预期故障注入，验证无半提交。既有Vite配置与Next standalone启动警告保留，不影响本次检查结果。

验收映射：ASSET-01~06/08的API+DB、SEC-01~04、SEC-06权限/缓存端点层、SEC-07输入层均实际验证；ASSET-07真实HTTP未接入标记通过、页面展示NOT RUN；SEC-05列表/详情旧批准投影回归通过，收藏/推荐全矩阵及资产页面待后续。MIG-01/03独立旧schema数据逐列比对与事务失败后重试通过；MIG-02 API投影回归通过，MIG-04运行回退演练NOT RUN。P1-01/02/03整体门槛尚不能标全量通过。

恢复：A只做加法，应用停用新入口后保留新表/字段/数据；不要drop表或回写旧迁移。B启用退役后只能回退到含退役防护的代码版本。审计及引用RESTRICT保留历史，被引用账号使用停用而非硬删除。无外部GitHub对象连通性或生产迁移/负载证明。
