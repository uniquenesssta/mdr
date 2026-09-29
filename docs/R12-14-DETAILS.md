# R12-14 — Log Redaction

## 最新验收：A01 修复完成（2026-09-29）

生产代码提交 `3cf4b683255d1f6f6ade72ab3df9f3e0474e435f` 的 [Windows Actions 36560794359](https://github.com/uniquenesssta/mdr/actions/runs/36560794359) 已验证：脱敏专项 **14/14**、真实前端 runtime/桌面适配器 payload → Rust 命令 → JSONL 回读 **1/1**、全量 Rust **215 + 5 + 1 + 6 = 227/227**，rustfmt、Clippy `-D warnings`、cargo check、既有 HTTP/本地文件契约、前端构建及两组浏览器回归均通过。Windows 使用 Node 22 和 Rust 1.88；原生 opener 编译链接通过。

全仓 Node **1420 项，1380 通过、40 失败**。失败名称与审计基线 `36554016082` 的 40 项逐项一致，无新增 R12-14 失败；这些明确登记的遗留项继续由 R12-18 等收尾任务处理，相关 CI job 仍如实失败，未删除、跳过或忽略失败退出。**R12-14/A01 专项功能验收通过并勾选；整个 R12 与产品交付仍未验收通过。** 当时 R12-15 尚未实施；其后已通过专项验收，见 [R12-15](R12-15-DETAILS.md)。12.20 后续复核本项成果，不重复修复。

本轮保留有界结构化对象/数组；Rust 统一处理嵌套、旧 JSON 字符串及二次编码。自由错误文本、未知字符串/标签、异常路径片段不写入日志；保留明确允许的操作/类别/状态、UUID、MIME 枚举和数值指标，合法路径只保留末级名称。代价是未知诊断文字显示 `[redacted]`，新增字符串标签须明确加入策略。没有改变日志开关、命令、批次/条目上限、依赖或 A04 重试协议。

证据见 [R12-14 Windows 验证记录](audit/r12-14-redaction-validation.json)。真实写盘回归使用合成秘密，不代表观测到真实用户泄漏；测试覆盖真实 JS 构造、实际平台适配器与 Rust 命令/文件 I/O，**没有将 VM 或直接命令调用冒充真实 WebView IPC/GUI 验收**。后续 R17 原生全链路义务保持。

验证迭代：首轮误把标签字符串 `write_performance_logs` 当函数调用，修正检查为调用语法；该失败曾导致工具安装步骤未运行，Clippy 缺组件，未当成通过。第二轮只剩三处 rustfmt 换行差异；按 Windows Rust 1.88 输出修正，随后补齐真实调用使用的 warning 告警枚举并增加端到端断言，同时让回读测试与写入端共用锁，避免并行测试读到未完成行；最终提交的全部 Rust 步骤通过。最终归档提交仅更新文档、证据及对应完成状态断言，未改变上述生产代码。

> **当前修复（2026-09-29）**：用户明确要求现在修复 R12-14，覆盖此前“全部等到 R12-20”的时间安排；只提前处理 A01，其余整改排期不变。前端保留有界对象/数组结构，Rust 唯一写盘边界递归处理正常及 JSON 字符串化数据，自由错误文本与未知字符串保守脱敏。操作/类别仅保留代码目录中的已知标签，状态/类型采用明确枚举，sessionId 仅保留 UUID；指标数值保留，路径仅保留末级名称，含查询/凭据等异常片段不保留。未知诊断字符串将显示 `[redacted]`，新增日志标签须同步明确允许值，不能恢复任意文本透传。
>
> 新增 8 项 Rust 边界回归（总 14 项）及实际 JS runtime → 桌面日志适配器 payload → Rust 命令 → JSONL 写盘回读测试。前端 VM 仅取消 DOM observer 安装并暴露原函数，不替换 payload 构造；测试使用真实平台适配器，但不代表真实 WebView IPC 传输已被验证。Rust 子测试调用 Node 22 生成输入，失败必须导致测试失败。循环/深度/数量预算防止诊断对象失控；保留 debug/release 开关与现有批次/条目上限，不修改 A04 重试协议。当时实现待验；现已完成上方最新验收并勾选 12.14。
>
> 有意契约变化：自由文本不再原样写入；字段名/嵌套结构可解析且处理有界；旧“前端 payload 必须逐字不变”的断言替换为实际结构与安全行为验证。历史 manifest 不改写，新增测试不取消原字段/路径/指标覆盖。其他累计 40 项已知失败仍归 R12-18 等后续整改，不因本项修复标成全绿。

> **此前排程记录（已由文首最新修复结果覆盖）**：下方“不推进 12.15”等为此前验收裁定。按用户新安排，先完成原计划至 12.17 的独立职责，再执行 R12-18～24；12.14 的 A01 功能验收保持未通过，由 12.20 修复补验，12.24 通过才进入 R13。详见 [当前 R12 任务书](markdown-main-full-rewrite-taskbook-18-docs/13-阶段12-本地文件、链接、网页与日志 Rust 重写.md)。本轮只排程，不实施修复。

## 首次实现的基线与范围

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

## 修复前状态记录

截至 2026-09-29，精确提交 `3cc56f09188ef9c432247788723e36415f9f3e03` 的既有 Actions 已全绿；本轮验收发现真实前端 payload 与 Rust 脱敏的衔接缺口，结论为验收未通过。12.14 保持未勾选，不推进 12.15。详见下方验收裁定及 [当前完整审计](CURRENT_AUDIT.md)。

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


## Clippy 修复与实测结果（2026-09-28）

验证入口修复提交 `1a0cd7471d878dfb5621299fe95d8bd3cea91470` 的 Actions `36442964433` 已真实通过脱敏 6/6、Stage 12 累计定向 Rust、全量 Rust（217、5、1、6 四组均无失败）、全量 Node、架构/文档和 Windows/macOS 原生边界。原来的 Cargo 多余参数故障已消除。

剩余 Rust 阻塞为 `redaction.rs` 第 60、65 行的 `clippy::manual_pattern_char_comparison`。仅将 `trim_end_matches` 与 `rsplit` 的双字符谓词改为 `['/', '\\']` 数组模式；匹配的正反斜杠、路径末级组件及其余脱敏行为保持不变，不增加 allow 或降低 `-D warnings`。六项 Rust 测试、命令计数和所有累计门禁均保留，修复后仍须精确 HEAD 复验。

同一 run 的浏览器契约在应用断言前报 `CDP endpoint did not become ready: fetch failed`；尝试单独重跑时 GitHub 因该 run 的 Rust job 尚在运行拒绝请求，未把重跑记为已启动或已通过。后续修复提交继续执行原浏览器契约、构建与 built-app 回归。

本地补充验证中，`node --test tests/unit/platform/performance-log-client.test.mjs` 因源码快照未安装 `@tauri-apps/plugin-dialog` 在模块加载阶段失败，未运行该文件的用例；不以 mock 绕过。该前端适配器源码未改变，完整依赖下的累计 Node 验证以 Actions 为准。本地新增的五个故障变体检查均能拒绝多余 Cargo 参数、遗漏两个源码触发路径、漏跑 scope 契约及弱化计数门禁，临时副本已清理。


## 验收裁定（2026-09-29）

用户授权验收后进行完整审计。本轮从远端完整检出 `agent/r12-stage`，初始工作区洁净，HEAD 为 `3cc56f09188ef9c432247788723e36415f9f3e03`；未更改生产源码、依赖、测试或工作流。

### 已核实的成功证据

[Actions #36444268636](https://github.com/uniquenesssta/mdr/actions/runs/36444268636) 精确验证上述 HEAD，4 个 job 全部成功。核对 job 步骤及 Rust/前端原始日志确认：脱敏 6/6、累计 Rust、全量 Rust 217+5+1+6、Clippy `-D warnings`、Cargo check、根目录 Node 452/452、平台与阶段定向测试 112/112、四项架构/文档门禁、浏览器契约 10/10、构建后浏览器 29/29、构建和工作区检查通过。此前 Cargo 参数、Clippy 和浏览器启动失败在该 run 中已消除。Windows/macOS job 只验证 opener 的编译、链接和函数签名，不能表述为完整桌面运行验收。

### 未通过原因

任务书 12.14 要求移除正文、完整路径和敏感字段，并覆盖递归对象。`src/runtime/performance.js:42–63` 的 `safeDetails()` 会把嵌套对象 JSON 序列化成字符串；`redaction.rs:81–99` 对普通字符串直接 clone。实际执行前端 `record()`/`flush()`（注入捕获 LogsPort，不冒充 Rust 落盘）确认 `details.nested` 已变成含 body/token/path 的字符串。普通 `error`、`message`、`reason` 也不进入字段名脱敏分支。由当前写盘调用链可直接确定这些字符串没有后续脱敏步骤。

六项 Rust 单元测试只覆盖对象形式的输入，没有覆盖前端序列化后的输入与实际 JSONL 内容；因此全绿不能满足完整验收。缺口在调试日志链路中生效，release 仍由既有 `debug_assertions` 关闭日志。本轮不修改前端或增加临时脱敏补丁。

**裁定：既有 CI 已通过；R12-14 功能验收未通过。** 保留任务书未勾选，暂不推进 R12-15。修复须覆盖前端日志构造、错误文本策略、Rust 唯一写盘边界与真实落盘断言，不通过删除失败输入或放宽测试来收尾。另有项目累计测试发现，见 [CURRENT_AUDIT.md](CURRENT_AUDIT.md)，不得把本任务 CI 视为全仓库回归通过。

