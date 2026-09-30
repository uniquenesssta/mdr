# R12-20 日志脱敏链路收尾复核

状态：链路复核与补充断言已完成，当前提交的 Windows 验证待运行；12.20 不勾选。分支 `agent/r12-stage`，复核基线 `83583712c3038561b8c432394bff0c9213271319`。

## 复核结论

A01 已由 R12-14 修复，本项按任务书复用有效证据，不重复实现。与首次修复提交 `3cf4b683255d1f6f6ade72ab3df9f3e0474e435f` 比较，`src/runtime/performance.js`、桌面 Performance Log/Invoke Client 和 Rust `redaction.rs` 的 Git blob 均一致。

12.15 将路径与追加写盘提取到 Paths/Writer，12.16 提取 Lifecycle，12.17 将 Tauri 命令迁到 `performance_log/command.rs`；当前前端平台仍注入真实日志适配器，命令、后端计时和生命周期都汇入 Writer。Writer 在 JSONL 序列化之前调用唯一 `redact_value`，release 在解析日志路径与写盘之前返回；不存在本项发现的绕过或回归。保留已知标签/状态、数值指标及路径末级名称，未知自由文本继续脱敏。

当前链路为前端 `safeDetails` 有界结构化数据 → LogsPort/PerformanceLogClient → `write_performance_logs` → Writer → Redaction → JSONL；后端计时/Lifecycle 进入同一个 Writer。没有改变生产代码、依赖、日志开关、冻结模型或 A04 批次重试行为。

## 有效 Windows 证据与本轮补充

[R12-19 Windows 运行 36664847931](https://github.com/uniquenesssta/mdr/actions/runs/36664847931)，提交 `d269fad613ab85f9f36f474c87c2e53271aaa022`，Rust job `109727216437` 已通过：递归脱敏 14/14、前端 payload 2/2、实际 Rust 命令 JSONL 回读 1/1、Writer 9/9、Lifecycle 6/6、release Writer/Lifecycle 不落盘、全量 Rust 250/250、Clippy `-D warnings`。这验证了拆分后的现行链路；整体 CI 的唯一既有 Preview 循环依赖失败仍归 R12-22，未豁免。

现有测试已覆盖嵌套/双重编码对象、错误文本、数组、循环、BigInt、非有限数和计数/时长。任务书点名的错误原因链与异常输入缺少明确的 JSONL 回读断言，本轮在现有实际前端 producer 和唯一落盘回归中补充：

- 合成 `message → cause → reason/password/causes`，验证秘密与错误文本不落盘，同时保留每层计数及合法路径末级名称。
- 抛错的可枚举属性，经真实前端 `safeDetails` 变为异常标记，经 Rust 脱敏后仅留 `[redacted]`。
- 明确回读数组内正文/token、自由文本、路径、循环标记、BigInt/非有限数及数组限长结果。原来的全部秘密扫描、编码对象与时长断言保持。

现有 JS payload 仍为 2 个测试，Rust pipeline 仍为 1 个测试，直接脱敏仍为 14 个测试。没有通过减少测试、改变允许字段或放宽断言来消除失败。原 R12-14 自动入口沿用原文件路径，显示名改为 R12-20；全部 Windows 累计门禁继续执行，历史步骤名保留便于现有契约识别。

## 验证与续接

本地仅保存远端精确文件快照，未冒充完整 Git 历史；两个修改的 JS 文件通过 `node --check`，工作流 YAML 与 53 个 shell run block 通过静态语法检查，文档相对链接、blob 比较记录及 `git diff --check` 通过。没有在 Linux 执行产品测试、Rust 构建、浏览器或平台验收；本地未安装 rustfmt，修改的 Rust 测试格式检查交由现有 Windows 门禁。当前补充断言必须由 Windows Actions 执行，结果查询后再更新 12.20 状态；不将既有通过证据冒充本轮新断言已通过。

[机器可读复核记录](audit/r12-20-log-review.json) 保存原/现行 blob、有效 run/job 与待验证矩阵。R15.3 迁移时须继承这些真实落盘断言；真实 WebView IPC/桌面 GUI 验证仍按 R17，本测试不替代该验收。

会话执行偏好（用户于 2026-09-30 明确）：推送触发 GitHub Actions 后立即结束本轮，不轮询。约 15 分钟后由用户发起“查询 R12-20 CI”，再核对精确提交、专项步骤与已有 Preview 失败，必要时继续修复。Windows 结果未确认前不推进 R12-21。

回退：仅撤回本项测试扩充与工作流/文档变更，保留 R12-14～19 已验收的生产修复，不撤回 A01 脱敏规则。
