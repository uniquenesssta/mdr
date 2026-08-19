# Markdown Editor

模块化 Markdown 编辑器。Stage 11 执行 R11-02：Serde DTO 已迁入 `document_store/types.rs`；`TextChange` 保持既有公开 facade，其余 DTO 为 crate 级入口。JSON、Tauri 命令、磁盘/恢复/UTF-16 语义及依赖不变。最新验证确认整份旧 `document_store.rs` 的 rustfmt 差异属于本 Atomic 外既有格式，已恢复为仅检查新增 `types.rs` 与兼容测试；完整 Clippy/Rust/Node/Browser/Build 门禁不变。全部通过前不收口、不进入 R11-03。详情见 [R11-02](docs/R11-02-DETAILS.md)。
