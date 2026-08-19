# Markdown Editor

模块化 Markdown 编辑器。Stage 11 R11-02 已将 Serde DTO 迁入 `document_store/types.rs`，JSON/Tauri/磁盘/恢复/UTF-16/依赖契约不变；`TextChange` 测试改为直接引用类型模块，未增加 allow 或放宽门禁。Stage 10 既有兼容契约继续由完整回归冻结。当前最终 HEAD 正重新执行 Rust/Clippy/Node/Browser/Build 门禁，通过前不进入 R11-03。历史见 [docs/README.md](docs/README.md)，本次详情见 [R11-02](docs/R11-02-DETAILS.md)。
