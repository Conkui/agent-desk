# 模块设计与接口边界

> 历史归档，已被 [Agent Desk 独立架构](../architecture.md) 替代。下文“HAPI 为唯一底座”不再是项目方向，保留仅为解释原型来源。

## 基础选择

以 HAPI 为唯一会话与移动访问底座。保留上游 web / hub / cli / shared / ios / android 的职责，不在旁边重建另一套会话服务。实际新增协议类型应整合进 HAPI shared。

当前 Demo 已实现协调器驱动的任务组，采用 `hub/src/workflows/` 中的应用服务、会话端口、HAPI 适配器、原子文件日志和结构化错误观察；界面与协议分开。API 为 `GET/POST /api/workflow-runs`、`POST /api/workflow-runs/:id/stop`、`POST /api/workflow-runs/:id/complete`。日志位于本地 `.local/demo/workflow-runs/`，状态通过轻量轮询更新，成员输出与审批复用现有 SSE。

统一 API 配置通过 `GET/PUT /api/machines/:id/agent-api` 与 `POST /api/machines/:id/agent-api/probe` 转交 Runner；服务端限制 owner 命名空间与设备归属。密钥只在运行机器保存、读接口不返回原值；Codex 在写入和测试的运行时校验中均被排除。项目模块位置见 [Demo 说明](../demo.md)。

以下 DAG、事件补发和恢复方案是后续完整产品设计，不代表 Demo 已全部实现。

## 拟新增模块

| 模块 | 职责 | 禁止承担 |
|---|---|---|
| shared/workflows | 工作流、节点、运行事件、能力类型与校验 | 数据库、SDK、UI |
| hub/workflows/domain | 依赖校验、节点状态迁移、并发与重试规则 | HTTP、进程启动 |
| hub/workflows/application | 创建运行、调度可运行节点、取消、恢复 | 厂商命令拼接 |
| hub/workflows/ports | SessionLauncher、RunStore、EventPublisher 接口 | 具体实现 |
| hub/workflows/adapters | 复用 HAPI runner/session 与 SQLite | 定义业务规则 |
| hub/routes/workflows | 参数校验、命令去重、调用应用服务 | 调度实现 |
| web/src/features/workflows | 列表、依赖图、运行详情和交互 | 调用 CLI 或操作数据库 |
| web/src/features/onboarding | CLI 扫描结果、选择与能力说明 | 读取或上传密钥 |
| cli 的设备探测模块 | PATH/版本/配置就绪状态检测 | 自动安装或执行 Agent 任务 |

依赖方向：页面 → API 客户端 → 路由 → 应用服务 → 领域与端口。适配器实现端口，由组合入口注入。跨模块只导入公开入口。注释解释权限、事件顺序、失败恢复与不支持的能力，不重复代码字面含义。

## 核心模型

- AgentProfile：CLI 类型、工作目录、模型、启动权限、可兼任的 roles[]。
- WorkflowDefinition：节点、依赖、分配策略、最大并发和失败策略。
- WorkflowRun：定义快照、状态、创建时间、版本号。
- NodeRun：sessionId、attempt、幂等 commandId、审批/等待原因。
- RunEvent：runId、nodeId、递增 sequence、事件类型与最小载荷。

协调器与 worker 是能力角色，不是强制独立进程。单实例可顺序规划和执行；同种 CLI 可以创建多个独立会话。协调器提交结构化调度请求，本地服务校验范围、预算和依赖后执行。不可恢复的 CLI 不自动重放可能有副作用的任务。

## 后续完整编排 API（草案）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/workflows | 列出定义 |
| POST | /api/workflows | 校验 DAG 并创建定义 |
| POST | /api/workflow-runs | 以 commandId 幂等创建运行 |
| GET | /api/workflow-runs/:id | 运行及节点状态快照 |
| POST | /api/workflow-runs/:id/cancel | 幂等取消；等待 CLI 确认后终结 |
| POST | /api/workflow-runs/:id/nodes/:nodeId/retry | 明确创建新 attempt |

事件复用现有 SSE 通道，增加 workflow 事件类型，按 sequence 补发；审批继续走原会话接口。上述路径需在实现前与上游路由核对。网络重连不重新创建任务。

## 实施顺序与验收

1. 修改真实 HAPI 页面，保持会话功能、权限和响应式布局。
2. 实现设备探测与单节点工作流，验证一种 CLI 也可完成全流程。
3. 增加依赖调度、取消、断线重放与失败恢复的边界测试。
4. 原生客户端接入相同工作流协议；Web 响应式优化不等于完成原生 APP 改造。

接口测试重点：循环依赖、重复 commandId、重复事件、运行期间撤销设备、取消与完成竞态、不能恢复的 CLI。禁止把 CLI 已安装等同于登录有效或执行成功。
