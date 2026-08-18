# Markdown Editor

模块化 Markdown 编辑器。Stage 11 正在执行 R11-02：Serde DTO 已迁入 `document_store/types.rs`，`document_store` 以 crate 级显式 re-export 保持原调用路径；JSON、Tauri 命令、磁盘/恢复/UTF-16 语义与依赖不变。首轮 CI 的 Clippy 可见性问题已修正；第二轮仅因 scope guard 仍匹配旧 `pub use` 而停止，guard 已同步为 `pub(crate) use`，未放宽文件范围，现重新全链验证。详情见 [R11-02](docs/R11-02-DETAILS.md)。
