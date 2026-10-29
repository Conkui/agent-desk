# 模块与开源复用

状态：设计及待执行的迁移清单，不表示完成了模块抽取。

## 自有模块

| 模块 | 拥有的规则 | 边界 |
|---|---|---|
| workflow-core | 角色、归属、状态机、失败与重试 | 纯函数和领域类型 |
| workflow-service | 发布、派发、取消、恢复、审批、确认 | 应用命令与抽象端口 |
| agent-runtime | 探测、进程、输入输出、取消与恢复 | Runtime 实现 |
| agent-adapters | 各 CLI 的事件、工具、审批、恢复标识转换 | 能力目录与适配器工厂 |
| provider-config | 可写字段、协议、秘密引用、环境注入 | ProfileService 与 SecretStore |
| storage | 事务、迁移、事件补发、幂等 | 仓库与日志 |
| transport | 本地/私网/中转、配对与重连 | DeviceTransport |
| console/mobile | 工作流交互与输出 | 本项目 API 客户端 |

各包只从 `src/index.ts` 暴露入口，不跨模块导入内部数据库表、进程对象或厂商私有类型。注释解释约束与原因，不复制代码字面含义。

## 自有原型代码迁移候选

| 当前位置 | 目标及必要调整 |
|---|---|
| `hapi/hub/src/workflows/service.ts` | workflow-service，替换 HAPI Session 端口 |
| `hapi/hub/src/workflows/runStore.ts` | storage 的迁移输入，原 JSON 日志保留 |
| `hapi/hub/src/workflows/observations.ts` | 错误映射参考，优先结构化事件 |
| `hapi/shared/src/workflows.ts` | contracts 的输入，拆分定义、运行、成员、attempt |
| `hapi/cli/src/agent/apiSettings.ts` | provider-config，独立 SecretStore，保留 Codex 写入禁令 |
| `hapi/cli/src/agent/apiProbe.ts` | 显式小请求测试，不自动计费探测 |
| `hapi/web/src/features/workflows/` | console，移除 HAPI AppContext、路由和协议依赖 |
| `hapi/web/src/features/agent-settings/` | console/settings，改为自有配置端口 |

## HAPI 逐模块评估

| 候选能力 | 复用边界 | 不继承的产品结构 |
|---|---|---|
| CLI 进程监督、输出、恢复 | 逐 CLI 抽取最小模块，保留测试与来源 | 整套 HAPI Runner 不能冒充自有入口 |
| 工具与消息标准化 | 转换为 RuntimeEvent | HAPI shared 不作为自有公共协议 |
| 权限审批校验与去重 | 绑定本项目 run/member/request | 不默认绕过审批 |
| 对话、工具详情、文件和终端 | 依赖 API 端口的组件 | 不复制 SessionList、独立会话创建器与上游设置全集 |
| 移动连接与恢复经验 | 参考失败处理与协议 | 原生 HAPI App 不等于本项目 App |

每个实际复用模块记录仓库、commit、源路径、许可证、版权头、依赖和本地修改，关于页可查看归属。尚未完成逐文件依赖与许可证审计的模块只标为候选；不能为了独立品牌删除上游署名。

暂不迁入：独立会话与导入全部历史入口、独立项目浏览器、语音助手、通用存储及费用看板、上游网站。必要诊断归属设备页，待处理归属工作流。旧源码和数据先留作参考，对应能力通过独立版验收后再逐项清理。
