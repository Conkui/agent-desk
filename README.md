# Agent Desk

个人多 Agent 工作流工作台。独立版代码位于 `apps/` 与 `packages/`，使用自己的界面、本机服务、协议、数据库和编排；HAPI 留作原型参考，不是本版本的运行入口。

## 运行独立版

双击 `start.cmd`，或在 PowerShell 运行 `./start.ps1 -NoBrowser`。

- 入口：`http://127.0.0.1:4190/workflows`。
- 首次连接密码：`.local/agent-desk/connection-password.txt`，不对外分享。
- 工作流画布复用 React Flow，点击节点打开消息面板。可设置编排器创建节点的权限和数量，安排节点执行后汇总。
- 设备页使用 ACP Registry 名录与 acp-router 探测模块识别本机 Agent；实际执行适配目前为 OpenCode。
- 电脑与 Agent 服务只监听回环地址；不自动开启公网端口、端口转发、防火墙例外或公网隧道。
- 安装、缓存和数据留在项目 `.local/`，默认优先 E 盘。Codex API 与原生全局配置不修改。

当前真实验证使用 OpenCode + DeepSeek 官方 `deepseek-flash` 的简短任务。Claude/DSH 执行适配器、文件终端页面、原生手机 App 与跨网中转仍未完成，不将配置入口或模拟测试当作这些能力通过。

[独立版使用及手机私网接入](docs/independent-demo.md) · [设计索引](docs/design/README.md) · [来源与复用](third_party/README.md)

## 代码职责

| 目录 | 内容 |
|---|---|
| `apps/console` | 工作流、运行详情、成员对话及必要设置 |
| `apps/locald` | 固定回环监听、设备连接保护、HTTP/SSE 与服务组装 |
| `packages/contracts` | 类型与运行时校验 |
| `packages/workflow-core`、`workflow-service` | 领域规则、调度及执行端口 |
| `packages/agent-runtime`、`agent-adapters` | CLI 能力和 OpenCode 原生适配 |
| `packages/provider-config` | 项目 API 设置及秘密引用 |
| `packages/storage`、`transport` | SQLite 事务、持久事件、连接边界与认证 |
| `hapi` | 旧集成原型，保留原 AGPL-3.0 许可证及署名 |

开发检查：`bun run typecheck`、`bun run test`、`bun run build`。本机 Bun 位于 `.local/tools/node_modules/bun/bin/bun.exe`。`bun run verify` 只复核已有真实记录；首次显式使用 `--live` 会发送一个简短模型任务。

原型资料保留在 [Demo 记录](docs/demo.md) 和 [验证记录](docs/verification.md)；旧启动入口为 `start-prototype.ps1`，不要与独立版验证混用。
