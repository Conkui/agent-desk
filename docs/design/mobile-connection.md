# 手机连接方案（暂存，未实施）

2026-10-23。用户选择现有阿里云服务器自建中转，目前只有服务器 IP，没有域名。手机连接暂停实施，优先完善 PC 工作流页面。

## 连接路径

手机 HTTPS → 阿里云 frps（转发 TCP）← 电脑 frpc 主动出站连接 → 电脑 Caddy（HTTPS）→ 127.0.0.1:4190 Agent Desk。

采用成熟的 frp 与 Caddy，不自行编写隧道或加密协议。HAPI 的 tunwg 方案依赖域名，不作为只有 IP 时的首选；有域名后可另接 tunwg 适配器。HAPI 原生 App 使用自己的 Hub 协议，不能直接连接 Agent Desk API。

## 免域名 HTTPS

Let’s Encrypt 已开放 IPv4/IPv6 地址证书，使用 shortlived 配置，有效期 160 小时，必须自动续期。由电脑 Caddy 保存浏览器 HTTPS 私钥并完成证书申请/续期；证书挑战通过中转转发。必须先用安装版本校验配置和实际签发，不能把配置正确当成签发成功。

电脑的 Agent Desk、Caddy 业务监听、HTTP/TLS 验证监听均固定在 127.0.0.1。服务器只对外提供 HTTPS、证书验证及 frp 控制端口；控制通道使用单独凭据与证书验证，限制可转发端口。不新增电脑防火墙例外、UPnP、路由映射或公网监听。

## 配对与操作

PC 设置页填写服务器 IP、生成部署包、启动/停止连接并展示状态；部署包仅放项目 .local/ 内。PC 生成短期、一次性配对码，二维码将配对凭据放 URL fragment，手机确认后交换设备连接凭据，PC 可撤销某部手机。不建立账号体系。

首个手机客户端是响应式 Web/PWA，复用工作流 API 与 SSE；原生 App、后台推送分别推进。手机查看画布和节点消息、提交任务、处理审批。断网按 sequence 补发，不重新派发已执行任务。

## 数据和成本

工作流、会话、模型 Key 与 Agent 执行留在电脑。HTTPS 在电脑终止，中转正常工作时转发密文，但服务器仍能看到 IP、时间与流量；服务器被控制后可能通过 IP 控制权攻击证书签发或可用性，不能据此保证服务器失陷也安全。公网 HTTPS 入口仍需设备配对保护，即使电脑没有公网监听。

复用已有阿里云机器，不新增必须购买的服务器或域名；仍使用该服务器的带宽、流量和续费额度。电脑休眠或停止服务时手机无法执行任务。

## 后续实施与验收

1. 取得服务器 IP、系统、架构、SSH 端口/连接配置，检查 80/443 等端口的现有用途。
2. 固定 frp/Caddy 版本，校验官方发布文件摘要，安装和临时输出留在 E 盘。
3. 生成受限服务端部署包及电脑端配置。未经核对不覆盖服务器既有服务。
4. 本机验证真实 frp + Caddy 通道、证书验证、HTTP/SSE、停止及重连。
5. 部署阿里云并实际签发 IP 证书，确认所有电脑监听地址均为回环。
6. 手机切换蜂窝网络，验证配对、发布工作流、实时输出、审批、撤销和断线恢复。

当前没有部署服务器、申请证书或启用隧道；没有完成手机跨网验收。调研时安装的未使用依赖已从应用依赖中移除。

## 来源

- [Let’s Encrypt IP 地址证书和有效期](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)
- [Certbot 对 IP 证书的支持](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)
- [frp TCP/HTTP/HTTPS 转发](https://gofrp.org/en/docs/features/http-https/)
- [frp TLS 验证](https://gofrp.org/en/docs/features/common/network/network-tls/)
- [Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)
- HAPI 参考：hapi/hub/src/tunnel/，原文件和许可证保留。
