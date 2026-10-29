# 本地开发与交付边界

> 本文保留 HAPI 集成原型的历史启动和验证。当前自有 apps/console、apps/locald 与 packages/ 已可独立启动，请使用 [独立版说明](independent-demo.md)。架构与后续迁移见 [architecture.md](architecture.md) 和 [迁移计划](design/migration.md)；下列上游命令仅用于旧原型。

## 上游基线

仓库：https://github.com/tiann/hapi

本次拉取 commit：`5d8deb201189dc1f183c4f5bf38c87ec4d34dd70`。

保留上游 AGPL-3.0-only 及版权。未创建远端 fork、提交或发布。

## 开发启动

按上游要求安装 Bun 1.4.0；Node 使用 Vite 7 支持的 20.19+ 或 22.12+。本次环境已有 Node 20.15，通过临时 Bun 1.3.14 工具完成检查，未修改系统 Node；最终生产工具链仍应按上游版本复验。

在 `hapi/` 下执行：

```powershell
bun install --frozen-lockfile
bun run dev:hub
# 另一个终端；显式 loopback，避免开发服务器对局域网开放。
bun run --cwd web dev --host 127.0.0.1
```

打开 Web 开发地址，用本地 Hub 的访问凭据登录。新建会话需要已连接 Runner；没有设备时应该显示为空，不展示假在线状态。

生产 Web 构建：`bun run build:web`。手机连接请使用 Hub 的 HTTPS 地址，不使用 Vite 开发端口。不要把本地访问凭据、settings.json、数据库或日志提交到 Git。

## 当前 Demo 范围

- 已实现：第二版会话工作区、项目与 Agent 筛选、待处理入口、手机底部导航、三语言文案、中文无衬线字体回退。详见 design-v2.md。
- 已实现：本地一键启动、Runner CLI 扫描、OpenCode 本地安装选项、按 CLI 的 API 配置与最小连接测试、协调器驱动的任务组、单 Agent 兼任角色、任务日志与停止/完成操作。
- 已验证：真实 OpenCode + DeepSeek Flash 的双向会话消息；详见 [验证记录](verification.md)。启动与配置见 [Demo 使用说明](demo.md)。
- 尚未实现：任意 DAG 调度编辑器、原生 iOS/Android 工作流 UI。
- 尚未验证：Claude/DSH 的真实供应商联调、手机蜂窝网络、推送和 Tailscale 配对。没有购买、配置公网服务器。

页面继续复用 HAPI 会话与审批；任务组服务位于独立的 Hub 模块，展示组件不启动进程。当前手机端采用响应式 Web/PWA。
