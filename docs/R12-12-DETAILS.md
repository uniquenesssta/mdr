# R12-12 — Web Client

## 基线与范围

继续使用 `agent/r12-stage`，基线为 R12-11 验收提交 `fecd05b27da67ac73abd2f4c63c5c27675ae46be`。对应 Actions `35137179217` 四个 job 与全部步骤成功，因此 12.12 前置条件满足。本任务只迁移 reqwest Client 构建、浏览器默认 headers、10 次重定向和 30 秒超时，不提前实施 12.13 Response、12.17 Command Registry 或 R12-S01 Web Fetch Hardening。

## 实施

新增 `src-tauri/src/web_fetch/client.rs`，成为无共享状态的 Client 构建权威。`browser_headers()` 与 `Client::builder()` 的现有配置从 `web_fetch.rs` 原样迁移；入口只调用 `build_client()`。状态码、最终 URL、Content-Type、正文读取、空正文判断、DTO、命令和性能日志仍留在原入口，交给后续 12.13/12.17。

`src-tauri/Cargo.toml` 与锁文件保持不变：reqwest 仍是 `0.12`、`default-features = false`，并保留 `rustls-tls`、`gzip`、`brotli`、`deflate`、`json`。本轮不显式切换 TLS backend，也不调用 `no_gzip/no_brotli/no_deflate`；压缩与 rustls 继续由既有 Cargo 特性选择。Context7 核对 reqwest 0.12 ClientBuilder：`default_headers`、`redirect`、`timeout` 均为 builder 配置，压缩特性启用时自动处理相应编码。

## 验证设计

沿用 R12-11 真实 loopback HTTP 链路，并增加 gzip 响应：同一组测试在 `fecd05b` 拆分前和当前拆分后运行，验证真实 reqwest 自动发送 `Accept-Encoding` 并解压 gzip，同时继续覆盖浏览器 headers、10 次重定向、30 秒超时、错误顺序和响应契约。新增 client 单元测试冻结 header 值并验证重复构建无共享状态。Cargo/lock 逐字冻结，避免 rustls 或压缩特性漂移。

R12-12 工作流继续执行累计 Rust、Clippy `-D warnings`、Cargo check、全量 Node、依赖审计、架构、生产构建、浏览器、Win/mac 原生边界与最终工作区洁净检查。R12-11 工作流改为仅 `workflow_dispatch` 历史入口，不删除任何既有步骤。

## 当前状态

本地源码/契约修改完成；定向 Node 与文档门禁在提交前执行。容器没有 Cargo/rustc，完整 Rust、真实 gzip、Clippy、构建与浏览器以精确提交 Actions 为准。在专属 Actions 全绿前，12.12 不勾选，不推进 12.13。R12-S01 仍保持未完成，不因 Client 拆分而改变网页允许范围或抓取限制。

## 回退

回退本 R12-12 实现提交即可把 header 和 ClientBuilder 放回 `web_fetch.rs` 并恢复 R12-11 自动入口；不回退已验收的 12.11，也不改变用户数据、配置、依赖或 R12-S01 的待办状态。
