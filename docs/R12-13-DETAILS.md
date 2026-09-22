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

源码、契约和工作流按 12.13 边界实施中；专属 Actions 全绿前不勾选 12.13，也不推进 12.14。

## 回退

回退本 R12-13 Atomic Task 提交即可把 Response DTO/处理放回 `web_fetch.rs` 并恢复 R12-12 自动入口；不回退已验收的 12.12，不改变用户数据、配置、依赖或 R12-S01 待办状态。
