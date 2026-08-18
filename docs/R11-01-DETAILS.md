# R11-01 — Document Store Compatibility Fixtures

- 实现：新增只读 Rust 兼容测试与提交夹具，覆盖 A/B snapshot/meta、journal、截断 journal、损坏槽以及中文/Emoji/UTF-16 搜索边界。
- 来源：夹具固定自 Stage 10 收口提交 `a49d89918a20251287df28583ab29d4b6eb4c1de`，对应 `src-tauri/src/document_store.rs` blob `af58efc8ac19672e7834b5cd8bab26fd202f85aa`。
- 兼容：未修改生产 Rust、Tauri command、Serde DTO、磁盘路径/字节格式、恢复消息、Mutex 边界或依赖；R11-02 Types 未提前实施。
- 当前验证：R11-01 精确 CI 已通过 scope/provenance guard、Rust format、兼容夹具 5/5 与完整 Rust tests；任务书要求的全量 `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- --deny warnings` 失败。
- Clippy 阻塞：`src-tauri/src/document_store.rs:1011` 的 `use std::io::Write as _;` 为 unused import；`src-tauri/src/web_fetch.rs:26` 的 `format!("https://{}", trimmed)` 触发 `clippy::uninlined_format_args`。两项都已确认存在于 Stage 10 基线提交；当前 R11-01 scope guard 禁止修改 `src-tauri/src`，因此未擅自修改生产源码，也未通过 allow、忽略或降低门禁掩盖失败。
- 当前未完整执行：本次精确 CI 在 Clippy 硬门禁处停止，后续 `cargo check`、Node 344/344、architecture、browser contract、production build 与 built-app browser regression 均被跳过，不能引用旧提交树结果替代当前验证。
- 未提供：`npm run test:integration` 当前 package scripts 不提供该命令；若 R11-01 解除 Clippy 阻塞，将继续以真实 Rust 夹具、完整 Rust/Node/Browser/Build 回归作为替代门禁并记录结果。
- 状态：R11-01 未收口，不进入 R11-02。
