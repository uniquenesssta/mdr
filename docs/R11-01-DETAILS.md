# R11-01 — Document Store Compatibility Fixtures

- 实现：新增只读 Rust 兼容测试与提交夹具，覆盖 A/B snapshot/meta、journal、截断 journal、损坏槽以及中文/Emoji/UTF-16 搜索边界。
- 来源：夹具固定自 Stage 10 收口提交 `a49d89918a20251287df28583ab29d4b6eb4c1de`，对应原始 `src-tauri/src/document_store.rs` blob `af58efc8ac19672e7834b5cd8bab26fd202f85aa`。
- 前置清障：经用户明确授权，已修复全量 Clippy 暴露的 2 个 Stage 10 遗留 lint：删除 `document_store.rs` 测试模块中的重复 `use std::io::Write as _;`；将 `web_fetch.rs` 的 `format!("https://{}", trimmed)` 改为等价 `format!("https://{trimmed}")`。两项均不改变运行时行为、接口、数据格式或依赖。
- Scope guard：仍禁止其他生产源码、Cargo/package 契约变化，并精确限制上述两个生产文件相对 Stage 10 基线只能分别出现 `0/1` 与 `1/1` 的行级差异；未通过 allow、忽略或降低门禁处理 warning。
- Node 回归修复：精确 CI 曾出现 343/344，唯一失败为 `tests/documentation-layout.test.mjs` 的既有根 README 120–360 字符契约；未修改或弱化测试，而是把根 README 恢复为简洁状态并把完整记录保留在本文件。
- 已通过验证：精确 CI run `32154853180` 在提交 `1a59d556d0e57af4782fe1c2272fb53f80d68cf2` 上完整 PASS：scope/provenance、Rust format、兼容夹具 5/5、完整 Rust tests、全量 `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- --deny warnings`、`cargo check`、`npm ci`、`npm audit`（0 vulnerabilities）、R10-12 11/11、完整 Node 344/344、architecture/documentation gates、browser contract 10/10、production build、built-app browser regression 29/29、clean tracked tree。
- 未提供：`npm run test:integration` 当前 package scripts 不提供该命令；本 Atomic 已以真实 Rust 夹具、完整 Rust/Node/Browser/Build 回归执行替代门禁。
- 状态：实现提交已通过完整硬门禁；本记录与根 README 同步后，将对最终文档提交树再次执行同一 R11-01 工作流，最终树通过后方可正式收口。R11-02 未提前实施。
