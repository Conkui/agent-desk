# 来源与复用记录

独立版产品代码位于 apps/ 和 packages/。没有把 HAPI Web、Hub、CLI 或 shared 作为独立版依赖，也没有把整个上游入口换名。

| 来源 | 当前使用方式 | 版本/归属 |
|---|---|---|
| React / React DOM | 前端运行库，正常包依赖 | 19.2.3，MIT |
| Vite | 前端构建工具，正常包依赖 | 7.3.0，MIT |
| Zod | 本项目公开协议校验，正常包依赖 | 4.2.1，MIT |
| [eventsource-parser](https://github.com/rexxars/eventsource-parser) | OpenCode 原生输出的 SSE 分块、CRLF 与多行事件解析，正常包依赖；保留本项目的事件校验与节点归属处理 | 4.1.3，MIT，Espen Hovlandsdal；许可保留于安装包 |
| [React Flow](https://github.com/xyflow/xyflow) | 画布、交互、连线、视口、缩略图，正常依赖 @xyflow/react | 12.12.0，MIT，许可保留于安装包 |
| [Dagre](https://github.com/dagrejs/dagre) | 有向图自动布局，正常依赖 @dagrejs/dagre | 3.1.1，MIT，许可保留于安装包 |
| [react-markdown](https://github.com/remarkjs/react-markdown) / [remark-gfm](https://github.com/remarkjs/remark-gfm) | 节点消息 Markdown、列表、代码和表格渲染；不启用原始 HTML | 10.1.0 / 4.0.1，MIT，许可保留于安装包 |
| [Radix UI](https://github.com/radix-ui/primitives) | 节点消息弹窗、焦点管理和 Esc 关闭，正常依赖 | @radix-ui/react-dialog 1.3.1，MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | 节点、标签及操作图标，正常依赖 | lucide-react 1.61.0，ISC |
| [ACP Registry](https://github.com/agentclientprotocol/registry) | packages/agent-catalog/src/registry.json 公开名录快照，2026-10-23 获取；运行时不依赖远程名录 | Apache-2.0，许可保留于 third_party/acp-registry/LICENSE |
| [acp-router](https://github.com/puzige/acp-router) | 从 src/agents.ts 抽取 findExecutables 至 packages/agent-catalog/src/find-executables.ts；外围增加 Windows 后缀和本地目录识别，不复制版本探测或执行代码 | e5e49a9ff1b5a1e454d4cd57bcaab69bf04a8881，MIT，许可保留于 third_party/acp-router/LICENSE |
| Bun | 本机后台与 SQLite 运行时，项目本地工具 | 1.3.14；保留安装包附带许可 |
| OpenCode | 可选、独立安装的 Agent CLI，通过认证的回环 HTTP 接口调用；未复制其源码 | 本次本地版本 1.19.3；许可保留在安装包 |
| HAPI | 旧集成原型和行为参考；本阶段没有源模块抽取进独立应用 | tiann/hapi，5d8deb201189dc1f183c4f5bf38c87ec4d34dd70，AGPL-3.0-only；原源码、许可证和署名留在 hapi/ |

独立版采用重新实现的业务层和界面，运行时通过本项目 contracts 交互。未来实际抽取第三方源码时，在此增加源文件路径、commit、许可、保留的版权头和修改说明，不把仅参考或进程调用记为源码复用。

OpenCode 接口依据：[官方 Server](https://opencode.ai/docs/server/)、[官方 Config](https://opencode.ai/docs/config/)，并核对本机安装版 `/doc` 的 OpenAPI。只有匹配的接口才启用适配器，其他 CLI 不能仅凭已安装就标记支持执行。
