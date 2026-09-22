# R12-14 — Log Redaction

## 基线与范围

继续使用 `agent/r12-stage`，基线为已验收的 R12-13 提交 `3692eb913473a8be3a45f326f5d93656d6cf1fb2`。本任务由任务书 12.14 明确要求：移除正文、完整路径和敏感字段，并覆盖递归对象。

只改变性能日志写盘前的数据最小化；不提前实施 12.15 路径/Writer 拆分、12.16 Lifecycle 或 12.17 Command Registry，不修改前端日志 payload、日志开关、批量/单条大小限制、目录/文件名、命令名称、依赖或生产启用策略。

## 实施

新增 `src-tauri/src/performance_log/redaction.rs` 作为无状态递归脱敏权威，`performance_log.rs` 的 `append_values()` 在 JSONL 序列化前统一调用。对象和数组递归处理：

- 正文类字段（如 body/content/html/markdown/text 及其职责后缀）直接移除；
- 认证/秘密类字段（password/passphrase/secret/token/authorization/cookie/apiKey/credential/privateKey 等）直接移除；
- path/paths/file/files/directory/cwd 及以 path/paths 结尾的字段仅保留末级组件；
- contentType、contentLength、textLength、bodyBytes、sourceLength 等只描述大小/类型的诊断指标继续保留；
- `sessionId`、source/category/operation/duration/status 等既有日志结构保持不变。

历史 R12-01 manifest 继续保留 `commandRedaction: "none"`，作为改造前事实，不改写历史基线。

## 验证设计

新增 `tests/stage-12-log-redaction.test.mjs` 冻结本次允许的源码迁移、前端 payload/依赖不变、模块唯一所有权、历史 manifest 不变及 workflow 路由。Rust 直接执行 6 项递归脱敏测试，覆盖嵌套正文、敏感字段、Unix/Windows/UNC 路径、数组路径、指标保留和原语稳定。

R12-14 专属 workflow 继续执行 Stage 12 累计 Node/Rust、架构/文档、Clippy `-D warnings`、Cargo check、Production Build、Browser Contract/Built-app Browser、Windows/macOS 原生边界和工作区洁净检查；R12-13 降为仅 `workflow_dispatch` 历史入口。

## 当前状态

源码、测试、文档和工作流按 12.14 边界实施中；专属 Actions 全绿前不勾选 12.14，也不推进后续 Atomic Task。

## 回退

回退本 R12-14 Atomic Task 即恢复写盘前不脱敏的 R12-13 基线；不回退 12.13 及更早已验收职责，不改变用户数据格式、依赖或其他 Stage 12 能力。


## 首轮 CI 修复

实现提交 `1aa2b16762c9e8661692eaf276b943c15132df5f` 的 Actions 首轮在 Rust scope 前置契约停止。失败均为迁移配套：R12-14 workflow 仍有旧 `r12-13` 日志/Artifact 临时目录；三个历史模块清单测试因不必要地修改了既有 `performance_log.rs` 描述而失配。生产 `redaction.rs` 规则尚未进入 Rust 行为测试，未发现生产实现失败。

修复恢复既有 `performance_log.rs` 模块描述，仅由新增 `redaction.rs` 表达新职责；同时统一 R12-14 临时目录和 scope 名称。历史职责和生产行为均不因此扩大。
