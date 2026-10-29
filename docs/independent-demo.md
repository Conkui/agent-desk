# Agent Desk 独立版 0.1

日期：2026-10-23。此版本在根目录 apps/ 与 packages/ 运行，不需要启动 HAPI Hub、Runner 或 Web。

## 启动

双击根目录 `start.cmd`，或运行 `./start.ps1 -NoBrowser`。默认地址 `http://127.0.0.1:4190/workflows`。可用 `-Workspace E:/your/project` 指定授权目录；目录内项目才允许启动，禁止通过相对路径或符号链接逃逸授权范围。

脚本使用项目内 Bun，安装、依赖缓存、临时文件与运行数据优先留在 E 盘 `.local/`。发布时一个 locald 进程同时提供前端与 API。前端按入口、画布、消息与设置编辑拆包，打开对应功能时加载；没有打包 HAPI 的完整界面。

首次连接输入 `.local/agent-desk/connection-password.txt`。这不是账号注册；凭据持有者能控制工作流，不能公开分享。浏览器会话使用 HttpOnly、SameSite Cookie，有效期 12 小时，断开浏览器连接可撤销。密码原值不出现在 URL 或日志。

旧原型启动器另存为 `start-prototype.ps1`，用于复查旧的 HAPI 实验，不作为独立版入口。

## 已实现

- 工作流定义、运行历史、成员会话安排；只有工作流与设置两类顶层入口。
- 列表操作菜单支持复制、归档与还原；运行面板支持集中查看结果、复制、导出 Markdown 和补充任务要求。节点与补充消息草稿保留在当前浏览器标签页。
- 画布区分“编排”和“运行记录”；右侧设置可修改任务、成员及权限。保存只影响后续运行，历史记录保留当时的定义。支持添加节点、自动布局，以及当前浏览器中的节点位置与视口记忆。
- 编排器执行并汇总任务；可设置是否允许创建节点、节点总数和工具权限。允许创建节点时先生成并校验计划；DeepSeek 使用普通 JSON 输出兼容思考模式，其他供应商使用原生结构化输出。新增节点执行后回传编排器；当前仍是顺序分工，不是任意 DAG。详见 [画布与节点消息](canvas-and-nodes.md)。
- OpenCode 原生回环 HTTP 接入，逐运行生成随机认证密码；按安装版 OpenAPI 校验接口。
- 成员真实文本、工具过程、原生工具请求的允许一次/拒绝；禁用外部目录。审批不绕过 CLI 原有边界。
- 继续对话、停止、人工确认结果。停止只有在受管进程退出后确认；重启遇到旧进程标为需要核对，不自动重发任务。
- 失败后自动释放进程，确认结束后可按原任务快照重新执行；不会以重试覆盖原记录。仍存在或无法核对的旧 PID 不会被误杀。
- SQLite 定义/运行/命令/事件存储；状态与事件事务提交，SSE 按 sequence 补发。前端收到事件后重读最新快照。
- 项目范围 API 设置；读取只返回已设置状态，Codex 写入在服务端排除。Claude、DSH 可保存各自协议的配置，执行适配器仍未接入。
- 自有 Agent Desk Logo、标题与轻量响应式 Web；提供主屏幕清单，不承诺离线执行或后台推送。

本地 CLI 仍拥有当前操作系统用户的权限。工具审批和原生权限规则不是操作系统沙箱，不应把它们写成任意恶意任务都安全的保证。

## API 配置

设置 → Agent API。Agent 与协议均使用下拉选择：OpenCode 支持 OpenAI 兼容 Chat Completions、Anthropic Messages，Claude 配置使用 Anthropic，DSH 当前配置支持 OpenAI 兼容。选择 Anthropic 时使用原生 Anthropic SDK，不把 Messages 当成 Chat Completions 发送。不兼容选项禁用且后端再次校验；无效 URL、误填完整 /messages 或 /chat/completions 路径时返回具体错误。空白密钥保留原值。

设备页常驻 OpenCode、Claude Code、DeepSeek Harness，与 API 配置和工作流工具选择共用能力与就绪规则；点击“配置 API”直达对应 CLI。API 配置不能代替 CLI 安装，识别可执行文件也不能代替执行适配。Claude/DSH 执行适配尚未接入，所以即使保存配置也不会标为可运行。其他可识别工具可从名录搜索查看。

扫描补充 Windows npm、WinGet、用户 Bun 与 .local/bin 路径，扫描不执行 CLI。配置仅注入新启动的项目子进程，原生 CLI 全局配置不变。密钥文件位于 `.local/agent-desk/profiles.json`，Windows 权限继承自项目目录，保持项目目录只对自己开放。

本次已显式导入先前保存在本项目的 OpenCode DeepSeek 配置，没有导入 Codex 或第三方 CLI 原生配置。需要在其他副本执行同类导入时可运行 `scripts/independent/import-project-profile.ts`；已有独立配置时拒绝覆盖。无需把密钥发到聊天里。

## 手机连接方案（暂缓实施）

用户已选择现有阿里云服务器自建中转，方案保存在 [手机连接设计](design/mobile-connection.md)。支持只有服务器 IP、没有域名的部署路径；当前仅保存设计，未安装中转、申请证书或修改服务器。现阶段优先完成 PC 工作流页面。

以下保留原有私网备选方式。

应用与 OpenCode 固定绑定 `127.0.0.1`，没有 Host 配置开关；不新增防火墙规则、UPnP、路由器端口转发或公网隧道。没有手机私网入口时，设置明确显示通道未配置。

首个可选方式是用户自行配置 Tailscale 私网 HTTPS Serve。Serve 仅供 tailnet 内设备访问；本项目不使用 Funnel。参考[官方 Serve](https://tailscale.com/docs/features/tailscale-serve)与[连接类型](https://tailscale.com/docs/reference/connection-types)。当前机器未检测到 Tailscale，没有自动安装、购买服务或修改网络。

1. 电脑和手机安装 Tailscale，加入同一个个人私网。
2. 先检查此电脑已有的 Serve 配置，避免覆盖其他用途，再手动执行 `tailscale serve --bg http://127.0.0.1:4190`。
3. 记录返回的 `https://…ts.net` 私网地址，使用 `start.ps1 -PrivateOrigin https://…ts.net` 重启独立版。
4. 手机浏览器打开该私网地址，用本项目设备连接密码连接。后端只接受明确配置的私网 Origin；不开放任意 CORS。
5. 用真实蜂窝网络分别测试任务提交、输出、审批、重连；当前尚未完成这些验证。

`scripts/independent/phone.ps1` 只做检测和显示步骤，不启用网络共享。私网设备仍需访问规则和设备凭据；不开放公网端口降低暴露面，并不保证电脑或已配对手机失陷后仍安全。

阿里云中转尚未启用，当前没有远程转发程序。后续中转必须由电脑主动建立出站连接，保留设备配对与内容加密，不能将本机 API 直接发布到公网。

## 验证与边界

相关单元/HTTP 测试覆盖幂等、状态、审批、越界路径、Host/Origin、连接凭据与配置保密；不需要模型流量。`bun run typecheck` 与 `bun run build` 分开执行。

真实验证：从自有 API 发布一个只要求回复固定文本的工作流，使用 OpenCode 与 DeepSeek 官方 `deepseek-flash`；输出命中预期，并从 OpenCode 原生 SQLite 核对实际模型/供应商。验证后确认结果并结束进程。证据在 `.local/agent-desk/verification.json`。`bun run verify` 只复核已有记录，首次真实执行必须显式传 `--live`。

双节点简短真实链路已验证，详见 [PC 完善记录](desktop-usability.md)。尚未完成：复杂项目协作与真实工具审批、Claude/DSH/Codex 执行适配器、CLI 原生问答工具、文件/终端页面、任意 DAG、手机实机跨网、服务器中转、原生 App 和后台推送。模拟运行的通过不能替代这些验收。
