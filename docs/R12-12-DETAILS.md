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


## 首轮 CI 修复

实现提交 `afa56ba7757444ac192f6ebbad3b5bc85c9f84fc` 的 Actions `35311301877` 正常解析并启动；Windows/macOS 原生边界通过，但前端累计契约与 Rust scope gate 在真正 Cargo 验收前失败。失败均为历史源码位置断言：R12-09 仍固定检查 `r12-11` 临时证据目录，R12-01 安全契约仍只在 `web_fetch.rs` 查找 redirect/timeout，平台 Web Fetch Client 契约也仍假定 redirect 位于入口文件。新 R12-12 七项契约全部通过，未发现生产 Client 行为失败。

仅迁移上述三项历史断言到 R12-12 工作流路径和 `web_fetch/client.rs` 权威位置，不修改生产代码、依赖、错误、超时、重定向或压缩配置。修复后先运行相关 Node 契约，再以新提交完整 Actions 为验收依据；首轮失败不能计为 12.12 通过。

## 第二轮 CI 修复

修复提交 `2203af35f27134b9fa2501292e86aa08e7ed45bf` 的 Actions `35311591477` 已进入完整流程：Windows/macOS 原生边界和新增 R12-12 七项契约通过。全量 Node 仅剩 README 360 字符门禁及两个历史模块总数仍为 439；Rust 仅在 rustfmt 检查发现 `web_fetch.rs` 与新增 gzip 测试的格式差异，尚未进入行为测试。

本次仅压缩根 README、把两个历史总数更新为当前 440，并按 Rust 1.88 rustfmt 输出调整两处格式；不修改生产 Client 配置、依赖、超时、重定向、压缩、响应或命令行为。定向本地检查：README 1/1、Stage 1 模块计数专项 1/1、Stage 10 Close Save 10/10；完整验收仍以新的 Actions 为准。
