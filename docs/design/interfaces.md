# 接口与运行约束

状态：独立版 v1 设计，不是现有 HAPI 接口文档。所有网络入参在 contracts 中同时定义 TypeScript 类型与运行时 schema；HTTP、WebSocket、CLI 结构化输入都必须经过验证。

## 1. 核心对象

| 对象 | 关键字段 |
|---|---|
| Device | id、name、online、platform、capabilities、lastSeenAt；不返回连接秘密 |
| AgentInstallation | installationId、deviceId、cli、version、available、capabilities、unavailableReason |
| ProviderProfile | id、cli、protocol、baseUrl、model、secretRef、hasSecret；读接口不返回 secretRef 或原密钥 |
| WorkflowDefinition | id、name、task、deviceId、directory、members、failurePolicy、maxConcurrency、version |
| WorkflowMember | id、name、installationId、roles、responsibility、permissionPolicy、profileId? |
| WorkflowRun | id、definitionId、definitionSnapshot、state、createdAt、version、lastSequence |
| MemberAttempt | id、runId、memberId、attempt、runtimeSessionRef、state、exitReason、lastSequence |
| ApprovalRequest | id、runId、memberId、attemptId、tool、arguments、directory、expiresAt、state |
| RuntimeEvent | schemaVersion、eventId、runId、memberId?、attemptId?、sequence、time、type、payload |

runtimeSessionRef 是本机内部标识，公共 UI 使用 memberId 与 attemptId，避免绑定某个 CLI 的 sessionId 格式。角色允许 coordinator 与 worker 同时存在；一个运行有且仅有一个协调角色，纯协调模式至少一名工作成员。

CLI 恢复、克隆或上下文压缩产生新原生会话 ID 时，由 Runtime 原子更新内部映射；按是否开启新尝试决定 attemptId，不能生成无归属的独立会话。前端成员链接与 runId 保持稳定。

## 2. HTTP

本机 API 前缀 `/api/v1`。现有原型 `/api/workflow-runs` 不被当成独立版协议。

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/health` | 版本、协议、启动状态；无秘密 |
| GET | `/devices` | 本机与配对设备状态 |
| POST | `/devices/:id/scan` | 明确扫描 CLI；不自动安装或请求模型 |
| GET | `/devices/:id/agents` | 检测结果和能力 |
| GET/POST | `/workflows` | 列表、校验并建立定义 |
| GET/PATCH | `/workflows/:id` | 定义及版本条件更新，不改正在运行的快照 |
| POST | `/workflows/:id/runs` | 以 commandId 发布一次运行，返回运行 ID |
| GET | `/runs/:id` | 快照、成员、审批摘要、lastSequence |
| GET | `/runs/:id/events?after=sequence` | SSE；从持久化日志补发 |
| GET | `/runs/:id/members/:memberId/messages` | 分页读取指定成员输出 |
| POST | `/runs/:id/members/:memberId/messages` | 追加消息，commandId 去重 |
| POST | `/runs/:id/members/:memberId/retry` | 明确创建新 attempt，保留旧输出 |
| POST | `/runs/:id/stop` | 发出取消意图；不能立即伪造进程已停止 |
| POST | `/runs/:id/confirm-result` | 用户确认结果，不冒充自动质量验收 |
| POST | `/runs/:id/approvals/:requestId/resolve` | allow/deny、scope、expectedVersion；有效性检查 |
| GET/PUT | `/provider-profiles/:cli` | 仅允许 claude/opencode/dsh，服务端排除 Codex |
| POST | `/provider-profiles/:cli/probe` | 用户显式触发，短输出、超时、重定向限制 |
| POST | `/pairing-codes` | 本机授权生成短期一次性配对码 |
| POST | `/pairings/claim` | 使用配对码建立设备连接，不是账号注册 |
| DELETE | `/pairings/:deviceId` | 撤销设备权限及后续事件订阅 |

发送消息、审批、停止与重试都带 commandId；定义更新与审批同时带 expectedVersion。客户端超时后查询原命令结果，不用新 ID 盲目重试。相同 ID 不同请求体返回 409。审批过期或已解决返回冲突及当前状态，不能二次执行。

文件和终端是运行内能力：路径受工作目录约束，终端连接绑定 runId/memberId 与设备凭据，不提供任意机器命令的通用公网入口。能力不足时返回 `capability_not_supported`，不自动降级为绕过权限的 shell。

## 3. 状态和事件

运行状态：`created / dispatching / running / waiting_input / waiting_approval / needs_reconcile / stopping / stopped / failed / awaiting_confirmation / completed`。成员 attempt 单独记录启动、工作、等待、退出和失败，避免一个成员空闲导致整个运行显示完成。

事件至少包括：`run.created`、`run.state_changed`、`member.started`、`member.output`、`member.tool_started`、`member.tool_finished`、`member.state_changed`、`approval.requested`、`approval.resolved`、`member.exited`、`run.result_proposed`。输出为增量文本或结构化片段；工具参数不能混入可执行命令通道。

sequence 在单个 run 内单调递增。客户端先读取快照，再从快照 lastSequence 订阅；以 eventId/sequence 去重。保留期外补发返回 `snapshot_required`，客户端重读快照，不能默默漏事件。重连不能触发创建运行或执行工具。

## 4. Runtime 端口

| 方法 | 约束 |
|---|---|
| `scan(device)` | 版本与能力探测，禁止启动任务或自动联网测试 |
| `start(context, profile, commandId)` | context 含 run/member/attempt、目录、权限、秘密引用；不向模型暴露秘密 |
| `send(attempt, message, commandId)` | 会话归属与存活校验 |
| `resolveApproval(attempt, request, decision)` | 保留 CLI 原生权限边界；不把不支持审批的 CLI 标为支持 |
| `stop(attempt)` | 进程树退出确认与超时结果 |
| `resume(attempt)` | 仅对支持恢复的适配器生效 |
| `events(attempt)` | 标准 RuntimeEvent；原始厂商帧留在适配器内部 |

CLI 适配器报告 `structuredOutput / approvals / resume / interrupt / files / terminal` 等能力。SDK、子进程与 ACP 不能互相假定等价。运行期间 CLI 断线进入 needs_reconcile；恢复不能重放已执行的工具。

## 5. 中转帧

帧外层仅有 protocolVersion、connectionId、recipientDeviceId、messageId、counter、ciphertext。设备间命令、响应和事件在密文内。握手验证设备身份、密钥和重放计数；配对码过期后不能重新授权。relay 不承担工作流状态数据库职责。

密钥交换、密码库选择和真实跨网故障测试是后续实现门槛，未完成前中转功能必须关闭。不能把示意帧当作已经安全可用的加密协议。

## 6. 错误、资源和秘密

统一响应含 code、可读 message、requestId、retryable；不返回原始供应商请求头、命令环境、密钥或完整堆栈。区分设备离线、CLI 缺失、认证失败、额度不足、限流、协议不支持和结果未知。

限制命令体、输出单帧、附件大小、并发成员数和日志保留量。安装、缓存、运行数据与诊断输出默认位于项目 `.local/`，优先 E 盘，不搬动用户原有 CLI 配置。
