# 验证记录

独立版更新日期：2026-10-23。下方历史章节保留 HAPI 原型记录，不能作为独立版通过的证据。没有训练或 GPU 工作。

## 独立版 0.1

### PC 日常操作（2026-10-26）

- 25 项测试、168 个断言、类型检查与生产构建通过。新覆盖工作流复制、归档恢复、启动/归档竞争、失败清理与快照重试、已退出与仍存活的非受管 PID、导出报告。
- 真实界面发布一次双节点工作流，经 DeepSeek 官方 deepseek-flash 完成规划、WORKER_OK 回报、TEAM_OK 汇总；一次补充要求返回 FOLLOWUP_OK。原生数据库 4 条 assistant 记录模型身份正确，无错误、无工具执行。确认后进程释放。证据：.local/agent-desk/usability-verification.json。
- 浏览器验证结果复制与导出、关闭重开后的补充要求草稿、工作流复制、归档、还原；导出留在 E 盘 .local/exports/。详细范围与剩余缺口见 [PC 完善记录](desktop-usability.md)。

### 四节点失败排查

- 2026-10-26 复查区分了两轮故障：首轮是已确认的 DeepSeek 思考模式/强制工具选择冲突；次轮已经完成规划，在模块检查的两项待审批命令处发生本机执行连接中断，历史记录没有更细的传输错误。原有适配器 + 真实 OpenCode + 本机模拟模型等待审批 190 秒后成功继续，未复现固定三分钟超时。本轮没有远程模型调用或重跑原任务。补充连接错误分类与输出订阅关闭处理，31 项测试、212 个断言及类型检查通过。详见诊断记录的复查段落。
- 已定位运行 7bcfe26c-aab6-46f7-8e90-f88fcea48d5e 在规划第一步被 DeepSeek 拒绝：HTTP 400，Thinking mode does not support this tool_choice；三个工作节点尚未启动。详见 [诊断记录](diagnostics/four-agent-planning-2026-10-23.md)。
- 修复 DeepSeek 规划请求、分离无工具的规划会话并改进分类提示。17 项测试、120 个断言、类型检查通过；真实 OpenCode 连接本机模拟服务的四节点链路通过，不产生远程模型调用。本次未重跑真实任务。

### Agent 联动与协议选择（本轮）

- 15 项测试、109 个断言、类型检查和生产构建通过。覆盖 Claude/dsh 命令扫描、Windows npm 与用户工具目录、设备/API/工作流就绪条件、不兼容协议、错误 URL 和完整请求路径、空白密钥保留、Codex 配置排除。
- OpenCode 1.19.3 真实进程连接本机 Anthropic 模拟服务，实际请求 /v1/messages，携带 x-api-key 和 anthropic-version 并返回 ANTHROPIC_PROTOCOL_OK。没有调用远程模型，也没有更改现有 DeepSeek 配置。证据：.local/agent-desk/anthropic-protocol-verification.json。这证明本机适配格式，不代表真实 Anthropic 账户已联调。
- 设备页、API 页和工作流选项共用能力定义，Claude/DSH 未安装时仍显示入口；只有已安装、执行已接入且 API 已配置的工具可启动。当前本机找到 OpenCode、Codex，Claude/DSH 未安装且执行适配仍未接入。没有自动安装它们或修改任何 CLI 全局配置。
- 浏览器已验证设备 → Claude API 联动、OpenCode 双协议选项、保存成功反馈、工作流选项与误填完整请求 URL 的错误提示；错误保存返回 400，现有配置保持原值。桌面和 390×844 窄窗口无横向溢出。截图：.local/agent-desk/screenshots/agent-devices.png、agent-devices-narrow.png、agent-api-narrow.png。

### PC 工作流编辑与消息（本轮）

- 13 项单元/HTTP 测试、79 个断言、类型检查和生产构建通过。新增覆盖定义编辑、幂等保存、版本冲突、目录范围及旧运行快照隔离。动态多节点执行测试使用模拟 Runtime。
- 实际浏览器在“项目检查（草稿）”中添加了结果复核节点，保存并刷新后仍为 4 个节点；未启动该草稿。拖动节点后刷新保留位置。节点设置能直接定位编排器字段，顶部状态栏为固定定位。
- 一次真实 OpenCode + DeepSeek 官方 deepseek-flash 简短任务返回 Markdown 标题和 PC_MESSAGE_OK。界面核对过程、传入、传出、原生 reasoning 各类记录；原生 SQLite 核对供应商 agent-desk 和模型 deepseek-flash。运行已确认完成，无清理错误，未留下 OpenCode 进程。证据：.local/agent-desk/pc-workflow-verification.json。没有调用 GPT/Codex，没有读写任务项目文件。
- 桌面 1280×720 与窄窗口 390×844 检查了画布、编辑抽屉和消息弹窗。修复桌面保存视角在窄窗口打开后节点落到屏幕外的问题：保留节点位置，窗口尺寸明显变化时重新适配视角。页面没有横向溢出。这是浏览器视口验证，不是手机跨网验证。
- 前端入口、画布、Markdown 消息与编辑器按需拆包；列表与历史选择器只读取运行摘要，所选运行单独加载。构建有第三方 use client 指令被忽略的非阻断提示。
- 截图：.local/agent-desk/screenshots/pc-workflow-desktop.png、pc-node-output.png、pc-workflow-narrow.png、pc-editor-narrow.png。源码、文档和脚本与本项目保存的密钥原值比对未发现匹配。
- 手机连接按用户选择保存为 docs/design/mobile-connection.md，未实施服务器部署、隧道或证书签发。独立版真实多节点结构化规划仍未验收，不能用单节点连通或模拟测试代替。

### 画布更新

- 画布、缩放、拖动和缩略图复用 @xyflow/react；节点消息弹窗复用 Radix Dialog。桌面和 390×844 视口核对了节点点击、消息分类、运行记录、新建权限表单与固定顶部栏，无横向溢出。
- 已保存一个明确标为草稿的三节点工作流用于检查连线；没有启动该草稿，没有新增模型请求。截图：.local/agent-desk/screenshots/canvas-desktop.png、canvas-mobile.png、node-mobile.png。
- 12 项测试、65 个断言以及类型检查、生产构建通过。新增动态规划开关/节点上限/双向交接测试使用模拟 Runtime，不能作为真实 OpenCode 规划通过的证据。
- 工具扫描使用 44 项名录，本机实际发现 Codex 与 OpenCode；扫描只检查文件，不执行这些 CLI。名称、安装位置和适配状态在设备页分开呈现。
- 本次未安装手机 App、未启用网络隧道；手机跨网仍未验证。

- 根目录 apps/ 与 packages/ 独立运行，入口为 start.ps1，默认 127.0.0.1:4190。未启动 HAPI、开放电脑公网端口或设置端口映射。
- 类型检查、前端生产构建、9 项相关单元和 HTTP 测试通过，覆盖工作流编排、幂等命令、审批状态、路径范围、连接密码、Host/Origin 和密钥不回显。模拟运行不能证明真实 CLI 审批或多 Agent 协作。
- 一次真实 OpenCode + DeepSeek 官方 deepseek-flash 简短任务返回 AGENT_DESK_CONNECTED；原生 SQLite 核对了实际模型与供应商。运行已确认完成，原生进程已结束。没有调用 GPT 或 Codex，未改变其全局配置。证据位于 .local/agent-desk/verification.json。
- 桌面与 390px 手机视口检查属于本机浏览器验证。Tailscale 尚未安装，手机蜂窝跨网、真实多成员协作、其他 CLI 适配器和原生 App 均未完成。
- 当前使用方法及限制见 [独立版说明](independent-demo.md)。以下为历史记录。

## 历史原型：工作流分组修正

- 首页 `/sessions` 按工作流列出；`/workflows/:runId` 展示任务和会话安排；`/standalone` 仅展示没有工作流归属的会话。成员归属由日志中的 sessionId 决定。
- 用现有真实 Hub 数据验证：6 条历史会话分成 2 个工作流（各 2 名成员）与 2 条独立会话。验证了筛选、搜索、成员切换、刷新后的归属、详情返回，以及取消新建独立会话后的返回。
- 浏览器实际 CSS 视口 1280×900 和 390×845；工作流详情和手机会话页无横向溢出。这是本机浏览器检查，不是手机跨网验证。
- 38 项相关 Web 测试及 8 项工作流 Hub 测试通过；包含超过 100 个工作流仍保留旧成员归属、命名空间隔离、同工作流导航和不存在的成员不可打开。Web/Hub 类型检查、Web 生产构建与 diff 检查通过。
- 登录「访问令牌」改称「设备连接密码」；模型上下文 Token 的弹层增加计量说明。仅调整文案，未移除连接保护。
- 截图位于 `.local/demo/screenshots/workflow-list-desktop.png`、`workflow-arrangement-desktop.png`、`workflow-arrangement-mobile.png` 和 `workflow-conversation-desktop.png`。
- 本次没有发送新模型请求，没有启动 GPT/Codex 联调，没有修改 API 凭据或第三方 CLI 全局配置。

## 通过

- HAPI Web TypeScript：`bun run typecheck:web`。
- HAPI Web 生产构建；字体调整后使用 Bun runtime 再次构建成功。
- SessionList machine-filter / search-pin-divider：2 个文件、6 项检查通过。
- `git diff --check`。
- 独立本地 Hub + 真实浏览器：1440×1000 桌面和 390×844 手机视口。
- 空会话状态、设备管理跳转、新建会话跳转；没有页面异常或横向溢出。
- 浏览器请求拦截的视觉 fixture：活跃/待处理/未运行状态、长标题、深色模式、会话详情导航。fixture 不写入数据库、不启动 CLI；不能当作真实 Agent 执行证据。

## 截图

- `../hapi/output/playwright/desktop.png`：真实空 Hub 的桌面页面。
- `../hapi/output/playwright/mobile.png`：真实空 Hub 的移动页面。
- `../hapi/output/playwright/desktop-fixture.png`：标注为视觉测试的会话数据。
- `../hapi/output/playwright/desktop-dark-fixture.png`：深色工作台。
- `../hapi/output/playwright/mobile-dark-fixture.png`：深色手机会话列表。

本地输出通过 `.git/info/exclude` 排除，不加入上游变更。

## 现有警告与限制

Node 20.15 低于 Vite 7 的支持版本；第一次构建成功但有版本提示，后一次改用 Bun runtime 构建。PWA `theme_color` 缺失警告在上游配置中有刻意不固定颜色的说明；构建另有现有大 chunk 与字体路径警告，没有扩展为无关重构。

该前端阶段尚未验证真实 CLI、蜂窝网络、Tailscale 配对、原生 App 构建和推送；后续进展如下。

## 功能 Demo 验证

- 一键启动：实际运行 `start.ps1 -NoBrowser`。本地 Bun 1.3.14、OpenCode 1.19.3 安装于 E 盘 `.local/`，真实 Hub/Runner 在 `127.0.0.1:4181` 启动并检测到 OpenCode。安装、缓存、临时文件及运行目录均由脚本指向 E 盘。
- API：用户提供的 SiliconFlow GLM 曾有一条真实回复，之后 GLM 和 V3.2 均返回 402；未把它们记为通过完整协作。改用用户提供的 DeepSeek 官方 `deepseek-flash`，16 输出 token 的最小请求返回 200（50 总 token）。
- 双 Agent：两个真实 OpenCode 会话，经 HAPI `hapi_ping_peer` 完成协调器→工作 Agent、工作 Agent→协调器的成功投递。协调器实际收到 `worker-ok` 并输出“团队通信成功”。不是 fixture 或生成器伪造的回复。
- 模型身份：以 HAPI 元数据中的原生 session ID 查询 OpenCode SQLite，两个会话的 assistant 记录均为 `providerID=hapi-managed`、`modelID=deepseek-flash`。没有用“保存了配置”代替模型执行证据。
- 请求开销：此次协调器曾使用 sleep/inspect 等待回报，造成多次短调用；现已将“不使用 sleep 轮询、等待时结束当前回复、明确结果不重复索取回执”写入派发提示。没有宣称该提示是硬性费用上限；新提示未重复做收费测试。
- 密钥：实际读接口只返回 hasApiKey；代码、文档不含真实密钥；检查运行日志未发现保存的密钥原值。Codex API 修改/连接测试由共享 schema 与 Runner 校验拒绝。
- 自动化：Web 全量 309 文件、3380 项通过；后续草稿与返回路径改动另跑 26 项通过。CLI 配置/有界探测 8 项通过；Hub 任务组/错误观察/配置路由 10 项通过；Shared 全量 327 项通过。全 workspace 类型检查与生产 Web 构建通过；收尾改动继续进行定向复验。
- 收尾验收：最新代码的 CLI 8 项、Hub 10 项、Web 26 项定向检查及类型检查通过。真实浏览器验证 390×844 手机视口和 1280×900 桌面视口无横向溢出；任务草稿经更新重载后保留、成员会话返回任务组后仍展开原记录。已从界面确认通信任务完成并结束会话，日志中的 completedAt 与 sessionsStoppedAt 均已持久化；只读复验仍通过。
- 截图保存在 `.local/demo/screenshots/`：`real-team-mobile.png` 为真实回报与汇总，`api-mobile.png` 为当前 DeepSeek 配置且无密钥原值，`workflows-desktop.png` 为桌面任务组。手机尺寸通过浏览器覆盖视口验证，不当作真实手机跨网证据。
- 夹具：已运行 `gen:fixtures`，内容无语义变化。增加 `.gitattributes` 固定夹具 LF，避免 Windows 自动 CRLF 导致字节比较误报。
- 上游全量：CLI 全量 2970 项通过、24 项失败，涉及 Windows symlink 权限、路径/文件模式断言、Node 20.15 缺少 Promise.withResolvers 等；Hub 全量 1379 项通过、17 项失败，涉及既有 PATH/home 路径断言和 Windows SQLite 文件锁等。Relay 测试打印结果后未退出，已停止该测试进程，不能记作全量通过。日志保存在 `.local/`，未将这些失败隐藏或宣称全仓通过。

当前通信测试的只读复验：

```powershell
& .local/tools/node_modules/bun/bin/bun.exe scripts/demo/verify.ts
```

它读取本机 Hub 与 OpenCode SQLite，不派发新任务、不请求模型；结果保存为 `.local/demo/verification.json`。会话 ID 与模型 ID 都来自实际记录。

手机跨网、Tailscale、原生 App 构建及推送仍未实测；当前电脑未安装 Tailscale。`scripts/demo/phone.ps1` 只做诊断并给出私网 HTTPS 连接命令，不自动开放服务。
