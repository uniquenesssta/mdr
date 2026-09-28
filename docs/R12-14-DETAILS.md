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


## 第二轮 CI 修复

提交 `fb0c590e4dcd602c350e2668ab2fa70c69e31b00` 的 Rust scope 前置契约已由 33/37 提升到 36/37；唯一剩余失败是 R12-09 历史测试仍固定要求当前累计 workflow 把 Linux schema 证据归档到 `/r12-13`。全量扫描确认 Stage 12 测试中其余 `r12-13` 引用仅是有意读取已完成的 R12-13 历史 workflow。修复只把该当前证据目录断言迁到 `/r12-14`。


## 第三轮 CI 修复

提交 `18f44f19146e6383beec2ab5b1eeb07e67683a1f` 已通过 R12-14 scope、全量 Node、架构/文档以及 Windows/macOS 原生边界。Rust 在行为测试前由 rustfmt 阻塞：12.14 workflow 新增时错误地把历史 `performance_log.rs` 整文件纳入 Rust 1.88/max_width=120 检查，会要求重排大量与本任务无关的既有代码。恢复 R12-13 的既有格式门禁边界，仅新增检查新文件 `performance_log/redaction.rs`；`performance_log.rs` 的两处允许变更继续由 R12-08/R12-11/R12-14 字节级契约保护，因此没有降低既有质量门禁。

同一 run 的 Browser Contract 失败为 Chromium 未暴露 page target，并伴随 runner DBus 连接错误；全量 Node 与架构门禁均已通过。该环境启动故障不修改生产代码，后续 run 继续执行同一 Browser Contract。


## 验证入口修复（2026-09-28）

修复基线为 `b988da7ddcf3f634f1d35841adab06e4898423f8`。其 Actions `35761578037` 的前端、Windows、macOS job 均成功；Rust 在 direct redaction 步骤因命令末尾两个反斜杠收到多余参数，报 `unexpected argument`，六项脱敏行为测试和后续累计 Rust 门禁均未运行。

本次修复将该 Cargo/tee 调用写为单行，保留 `--locked`、测试过滤器、原六项通过计数和失败即停；补上 `performance_log.rs` 与 `performance_log/**` 的 push 路径过滤，并让 Rust scope gate 执行现有 R12-14 契约。未改变生产脱敏规则、日志接口、依赖和其他 Atomic Task。

在已有 `tests/stage-12-log-redaction.test.mjs` 增加两项回归：精确验证直接测试命令及结果门禁；验证日志源码触发范围和 scope 契约调用。两项在修复前均失败，修复后均通过。

本地使用该精确提交的 Actions 源码快照（下载 artifact SHA-256 已核对），未把快照伪装为完整 Git 历史。实际执行：

- `node --test --test-name-pattern 'R12-14 (shell command|production log|recursively|makes|documentation)' tests/stage-12-log-redaction.test.mjs`：5/5 通过，其中生产规则检查为源码契约，不是 Rust 行为测试。
- `node --test tests/historical-workflow-routing.test.mjs tests/documentation-layout.test.mjs`：3/3 通过。
- 解析 workflow 后对 45 个 run block 执行 `bash --noprofile --norc -n`：全部通过；仅为语法检查将 Actions 表达式替换为普通占位词，没有执行或替代真实 Cargo 调用。
- `git diff --check`：通过；未发现其他行尾双反斜杠。

本地没有 Cargo/rustc，网络 DNS 无法解析 GitHub，不能克隆完整历史或安装工具链；未在本地运行全量 Node、Rust、Clippy、构建和浏览器门禁。修复提交由原 R12-14 Actions 执行真实验证，完成前 12.14 仍不勾选。复验入口为 `agent/r12-stage` 上的 `R12-14 Log Redaction Compatibility` workflow；不得以此前前端或原生成功替代修复 HEAD 的累计 Rust 结果。
