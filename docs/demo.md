# 运行 Demo

## 启动

在 `E:\project\mulitAgent` 双击 `start.cmd`，或在 PowerShell 执行：

```powershell
.\start.ps1 -InstallOpenCode
```

脚本将运行时、npm/Bun 缓存、安装文件与临时文件放在项目 `.local/`，不做全局安装。已有 Bun 则直接使用。当前验证版本为 Bun 1.3.14、OpenCode 1.19.3；上游发布工具链仍声明 Bun 1.4.0。首次需要联网下载依赖和构建，之后直接启动。开发修改前端后使用 `-Rebuild`。

默认地址为 `http://127.0.0.1:4181`。旧的 `4180` 是示例数据设计预览，不执行真实任务。

首次登录填写「设备连接密码」，内容来自 `.local/demo/access-token.txt`。这是原 HAPI 的访问令牌，用于保护电脑与手机的连接，不是模型 API Key 或模型 Token 用量。凭据持有者可以控制 Agent，不能公开分享。登录后浏览器会记住本机连接。终端保留运行，Ctrl+C 停止 Hub 和 Runner；已经启动的 Agent 会话按 HAPI 规则独立管理，需要时在工作流中停止。

其他项目目录可以这样启动，Runner 将限制可浏览、可启动的目录：

```powershell
.\start.ps1 -Workspace E:\your-project
```

不要同时对同一个 `.local/demo` 启动多个实例。端口被占用时会提前报错，不会结束占用端口的其他程序。

## API 设置与任务

进入「设置 → Agent API」，选择运行电脑，填写服务地址、模型 ID 与 API Key，保存后对新会话生效。密钥仅保存在 Runner 的 `.local/demo/agent-api.json`，读取接口只返回是否已设置；本项目不改 CLI 的全局配置。Windows 文件权限继承自项目目录，请把该目录保留在自己的用户控制范围内。

| CLI | 协议与范围 |
| --- | --- |
| OpenCode | Chat Completions 兼容接口。运行时注入专用 provider、主模型与辅助模型，限制为该 provider；不会自动换到 GPT。 |
| Claude Code | Anthropic Messages。需要对应协议的服务，不能直接填 Chat Completions 地址。 |
| DeepSeek Harness | 注入 `DEEPSEEK_BASE_URL` 与 `DEEPSEEK_API_KEY`；模型和 ACP 命令沿用本机 Harness 配置，需要单独安装。 |
| Codex | 不提供 API 修改，沿用用户已有配置。当前联调禁止使用 GPT/Codex。 |

当前用户指定的联调配置是 DeepSeek 官方 `https://api.deepseek.com`、`deepseek-flash`。密钥不包含在本文档或源码中。

「测试已保存配置」会在 Runner 上发送一条短请求，最多 16 个输出 token；只有点击才发送。它会区分认证、额度、限流和网络错误；有响应不代表 CLI 安装或工作流已经通过。

首页默认显示工作流列表，点击「新建工作流」：

1. 填写名称、电脑、项目目录和任务。
2. 选择协调器；默认也参与工作。可以只选它一个。
3. 按需添加工作 Agent，同一种 CLI 可以添加多次。写清楚各自职责。
4. 启动后进入该工作流详情，先查看任务内容和「会话安排」，再点击协调器或工作 Agent 查看真实对话、流式输出、文件、终端和权限请求。
5. 协调器使用 HAPI 的 `ping_peer` / `inspect_peer`（或 `hapi ping-peer` / `hapi inspect-peer`）派发与汇总。没有桥接能力时应报告问题，不伪造结果。
6. 「已派发」只代表初始任务交给协调器；用户查看结果后「确认完成」。「停止所有会话」会结束该组已记录的会话，保留历史。完成后可用「结束会话」释放进程，同时保留完成记录。

未发送的任务在当前浏览器标签页保留草稿。首页按全部、进行中、待处理、已结束筛选工作流，并支持任务名称、内容和目录搜索。工作流成员不会混入「独立会话」。进入成员对话后，桌面左侧只显示同一工作流的会话；手机顶部显示所属工作流，返回时回到其会话安排。直接打开或刷新成员链接也按真实成员 ID 恢复归属。设备离线或 CLI 不可用时不会偷偷换成另一个设备或 CLI。

对话底部的上下文用量使用 Token 计量文本长度，与设备连接密码无关，也不是累计费用。点击用量可查看说明；费用以 API 服务商账单为准。

Demo 是由协调器驱动的任务组，还没有任意 DAG 编辑器、自动质量验收、Git 隔离分支或跨机器调度。任务组内成员共用一个目录，协调器需要分配不同文件以免覆盖。请求 ID 防止网络重试重复启动；中途失败保留会话，Hub 重启不自动重放未确定的操作。

## 手机连接

目前使用响应式 Web/PWA，可添加到手机主屏幕。新增工作流界面尚未移植到上游原生 Android/iOS 应用。

优先使用 Tailscale 私网连接，无需购买中转服务器。PC 与手机都需安装客户端、登录同一个私网；Tailscale Personal 当前为免费方案。[官方价格](https://tailscale.com/pricing)

运行只读检查：

```powershell
.\scripts\demo\phone.ps1
```

脚本只显示安装/连接状态和后续命令，不安装 VPN、不改防火墙、不自动公开服务。安装并登录后，可按输出启用 `tailscale serve --bg http://127.0.0.1:4181`，再用 `start.ps1 -PublicUrl https://你的设备域名` 启动。手机打开该 HTTPS 地址，使用原配对凭据登录。Serve 只在私网内访问，勿换成公开的 Funnel，也不要覆盖已有的 Serve 服务。[官方 Serve 文档](https://tailscale.com/docs/reference/tailscale-cli/serve)

本机 Hub 仍只监听回环地址。手机跨网、真实键盘与系统通知需要在你的设备上实测，当前未做实机验证。如果日后用阿里云转发，Hub 会经过该服务器；API 设置请求中包含密钥，必须信任服务器和管理员，使用 HTTPS，并保留配对认证。

## 模块

- `scripts/demo/`：本地进程启动与只读网络诊断。
- `hapi/shared/src/agentApi.ts`、`workflows.ts`：跨端协议和校验。
- `hapi/cli/src/agent/apiSettings.ts`、`apiProbe.ts`：本机配置、进程环境适配和有界测试请求。
- `hapi/hub/src/workflows/`：任务组日志、应用服务、HAPI 会话适配与错误观察。任务记录位于 `.local/demo/workflow-runs/`。
- `hapi/hub/src/web/routes/agentApi.ts`、`workflows.ts`：认证后的 HTTP 边界。
- `hapi/web/src/features/agent-settings/`、`workflows/`：配置与任务页面；页面不直接执行命令。
