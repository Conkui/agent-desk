# 手机与 PC 通信决策

核查日期：2026-10-22。

## 默认：Tailscale + HTTPS Serve

个人免费档当前为 $0，适合单人 PC 与手机，不必购买 VPS。两端需要安装 Tailscale，并登录第三方组网账号；本项目不引入用户注册系统。免费额度和适用范围以官方定价为准。

路径：手机 → 私有 tailnet HTTPS 地址 → PC 的 Tailscale Serve → 本机 127.0.0.1:3006 HAPI Hub。可以直连时直连，否则由 Tailscale 中继。既不承诺所有运营商网络可达，也不承诺免费中继延迟；需用真实手机网络验证。

## 操作步骤（不自动更改用户网络）

1. PC 和手机安装并登录 Tailscale，将两者加入个人 tailnet。
2. PC 启动 `hapi hub --no-relay`，保持 Hub 绑定 loopback。
3. 执行 `tailscale serve --bg http://127.0.0.1:3006`，按提示启用 HTTPS。
4. 使用 Serve 返回的 HTTPS 地址与 HAPI 设备/访问凭据连接手机。
5. 手机使用蜂窝网络验证会话、审批、重连；关闭共享使用 `tailscale serve reset`（会清除此设备现有 Serve 配置，执行前确认没有其他服务）。

使用 Serve，不使用 Funnel 公开到互联网。保留 HAPI 访问凭据；二维码含敏感信息。限制 tailnet 访问范围。HTTPS 证书会公开证书中的机器域名，避免在设备命名里放敏感信息。

## 备选

| 方式 | 成本与代价 | 定位 |
|---|---|---|
| 局域网直接连接 | 无服务器费；需可互通网络，原生 APP 需可信 HTTPS | 可选，不能只用 HTTP 替代原生配对 |
| Tailscale Serve | 个人免费档；安装第三方客户端和账号 | 首选 |
| HAPI 公共中转 | 依赖公共服务政策和可用性，未确认长期费用承诺 | 自愿选择 |
| 已有阿里云 VPS | 不一定新增机器费用，但仍有续费、流量与运维成本 | 网络不通时备用 |

自建模式保留 Hub 与数据库在本机；服务器只承担经过设计与验证的隧道。不得把 Hub 移到服务器后仍宣称消息不离开 PC。HAPI 的 relay/ 是推送中转，不是网络隧道。

## 边界

组网加密不防止已配对手机或 PC 本身失陷。PC 休眠后无法执行任务。手机后台实时 SSE 不保证存活，需要推送；Android FCM 在目标网络的可用性及自建 APP 签名/推送凭据另行验证。

来源：
- https://tailscale.com/pricing
- https://tailscale.com/docs/reference/connection-types
- https://tailscale.com/docs/features/tailscale-serve
- https://tailscale.com/docs/how-to/set-up-https-certificates
- https://github.com/tiann/hapi/blob/main/docs/guide/deployment.md
