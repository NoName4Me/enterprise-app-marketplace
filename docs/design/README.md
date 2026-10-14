# 阶段 0 技术设计索引

## P1 本地设计草案

- [最小资产与生命周期设计](P1_ASSET_LIFECYCLE.md)：2026-10-14基于现有8c5a06f源码核对；本地草案，未实施。
- [对应验收用例](../acceptance/P1_ASSET_LIFECYCLE.md)：新功能全部NOT RUN；分资产/API、生命周期、工作台三批实施。

以下阶段0状态为历史交付记录；当前实现事实以源码、ROADMAP执行补充与相应工程证据为准。

| 内容 | 文档 | 状态 |
| --- | --- | --- |
| 技术架构、选择和替代方案 | [ARCHITECTURE.md](ARCHITECTURE.md) | 试行基线 |
| 最小权限矩阵、认证初始化 | [PERMISSIONS.md](PERMISSIONS.md) | 试行基线（若干实施假设） |
| 领域数据模型、状态转换及事务不变量 | [PUBLISHING_MODEL.md](PUBLISHING_MODEL.md) | 试行基线 |
| 技术选型的正式理由 | [ADR-001](../decisions/ADR-001-technical-baseline.md) | 试行接受 |
| 验收场景与测试数据 | [MVP1](../acceptance/MVP1.md) | 用例已定义，未运行 |
| 第一轮工程任务与交付报告格式 | [AGENT_TASK_01](../engineering/AGENT_TASK_01.md) | 待执行 |
| 部署、回滚及 Sites 兼容性检查 | [DELIVERY](../engineering/DELIVERY.md) | 方案已定义，部署未执行 |

## 阶段 0 交付覆盖表

| Issue #1 交付物 | 位置 |
| --- | --- |
| 登录/身份与创建权限矩阵、管理员初始化 | PERMISSIONS |
| 应用、审核申请、已发布内容分离与状态转换 | PUBLISHING_MODEL |
| 首轮页面/路由、架构、数据、部署和替代选型 | ARCHITECTURE + ADR-001 |
| 正常流程、拒绝、越权、公开隔离、并发与回滚验收 | MVP1 |
| 第一轮 AI Coding Agent 任务、独立验收、回退 | AGENT_TASK_01 + DELIVERY + 根目录 AGENTS.md |

### 实施前验证责任

**阶段 0 只交付经设计评审的文档，不等于阶段 1 已实现。** 当前尚未存在业务代码、真实自动化测试结果、部署结果或 Site 实测。认证组件兼容性、迁移运行和完整测试属于 T01～T05 的实现验证责任。技术基线可被证据修正。
