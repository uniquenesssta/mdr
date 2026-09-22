# R12-13 — Web Response

## 基线与范围

继续使用 `agent/r12-stage`，基线为已验收的 R12-12 收尾提交 `9b6d6369fce3f2b36a33cdd12dd28c4d0460d927`。对应 Actions `35753820989` 的 frontend、Rust 累计硬门禁、Windows 与 macOS 原生边界四个 job 全部成功，因此 12.13 前置条件满足。

本任务只迁移 Web Response 职责：状态码、最终 URL、Content-Type、文本正文、空正文判断、HTTP/正文读取错误和 `FetchResponse` DTO。命令注册、性能日志、URL Validation、reqwest Client、Cargo/lock 和前端 payload 均保持不变；不提前实施 12.14、12.17 或 R12-S01 Web Fetch Hardening。

## 实施

新增 `src-tauri/src/web_fetch/response.rs`，作为每次响应的无共享状态权威。原 `web_fetch.rs` 只保留 URL 规范化、Client 创建、请求发送/传输错误、Response 委托以及 Tauri command/性能日志；`FetchResponse` 通过入口稳定 re-export，现有命令和真实 HTTP 测试无需改调用方式。

R12-S01 继续保持未实施：本轮不增加响应大小上限、不增加 Content-Type allowlist、不改重定向策略，也不修正历史输入重解释行为。

## 验证设计

新增 `tests/stage-12-web-response.test.mjs`，以 `9b6d6369fce3f2b36a33cdd12dd28c4d0460d927` 为字节级基线，证明 DTO 和 response 处理只发生职责迁移；独立安全夹具只迁移源码所有权位置，不降低原断言。既有 9 个真实 loopback HTTP 用例在拆分前和拆分后运行同一行为集，继续覆盖 Unicode、gzip、无/非 HTML Content-Type、2 MiB 未限制正文、重定向、状态/空体/截断正文错误、连续请求与 30 秒超时。

R12-13 专属工作流继续执行前序 Stage 12 累计契约、完整 Rust、Clippy `-D warnings`、Cargo check、全量 Node、依赖审计、架构门禁、生产构建、浏览器回归、Windows/macOS 原生边界与最终工作区洁净检查。R12-12 工作流降为仅 `workflow_dispatch` 的历史入口。

## 当前状态

R12-13 已完成并验收。提交 `33744a848e1fdd26dfc91e22d2e87b12578ff9bd` 的 Actions `35756238550` attempt 2 四个 job 全部成功；下一 Atomic Task 可进入 12.14 Log Redaction。R12-S01 仍保持未实施。

## 回退

回退本 R12-13 Atomic Task 提交即可把 Response DTO/处理放回 `web_fetch.rs` 并恢复 R12-12 自动入口；不回退已验收的 12.12，不改变用户数据、配置、依赖或 R12-S01 待办状态。


## 首轮 CI 修复

实现提交 `ec6eb2c6f3b19d847b76d8f8a26c03159c192989` 的首轮 Actions 在 Rust scope gate 停止：37 个前置 Node 契约中 36 个通过，唯一失败是 R12-08 历史测试仍要求当前累计工作流使用 `r12-12/performance-logs` 临时目录。该断言随自动验证权威迁到 R12-13 后应检查 `r12-13/performance-logs`；生产 Response、依赖和外部契约均不因此改变。同时把 R12-13 工作流剩余的祖先检查统一固定到已验收的 R12-12 收尾提交 `9b6d636`。


## 第二轮 CI 修复

提交 `b13811cf96eec572eb27f924304929336428bc49` 已通过 R12-13 scope gate 与专属 Stage 12 契约。全量 Node 唯一失败是根 README 的历史文档契约仍要求显式保留 R12-08 条目和详情链接；Windows/macOS 原生编译、链接与工作区洁净均通过，但证据上传路径仍指向旧 `r12-12-native` 目录。修复仅恢复 README 的 R12-08 锚点并把 artifact path 对齐到 `r12-13-native`，不修改生产 Response、依赖或外部行为。


## 第三轮 CI 修复

第二轮 Rust job 在进入行为测试前由 Rust 1.88 `rustfmt --check` 阻塞，唯一差异是 `web_fetch.rs` 中 `use response::read_response` 与 `pub use response::FetchResponse` 的确定排序。按 rustfmt 输出同步入口及两个字节级迁移契约的期望值；Response 行为、DTO、错误、依赖和外部接口均不改变。


## 最终验收

提交 `33744a848e1fdd26dfc91e22d2e87b12578ff9bd` 的 Actions `35756238550` attempt 2 完整通过：Web Response/frontend regression、Real Rust Web Response and cumulative hard gates、Windows native boundary、macOS native boundary 均为 success。前一次 attempt 1 唯一失败为 CI Chromium 未能建立 CDP endpoint；同一提交的 attempt 2 已通过 Browser Contract、Production Build 与 Built-app Browser Regression，因此未为该环境故障修改生产代码或放宽测试。

R12-13 的状态码、最终 URL、Content-Type、文本正文、空体/HTTP/正文读取错误及 `FetchResponse` DTO 已由 `web_fetch/response.rs` 唯一负责；URL Validation、Client、命令注册、依赖与 R12-S01 均未提前改变。
