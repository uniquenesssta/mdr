# Markdown Editor

模块化 Markdown 编辑器。Stage 11 正在执行 R11-02：Serde DTO 已迁入 `document_store/types.rs`，`document_store` 仅以 crate 级显式 re-export 保持原调用路径；JSON、Tauri 命令、磁盘/恢复/UTF-16 语义与依赖不变。首轮 CI 已通过 JSON 4/4、R11-01 兼容 5/5 和完整 Rust，Clippy 暴露 facade 可见性问题并已按模块边界修正，现重新执行全链验证。详情见 [docs/README.md](docs/README.md) 与 [R11-02](docs/R11-02-DETAILS.md)。
