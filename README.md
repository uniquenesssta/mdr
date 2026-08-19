# Markdown Editor

模块化 Markdown 编辑器。Stage 11 R11-02 已完成 Serde DTO 向 `document_store/types.rs` 的职责迁移，JSON/Tauri/磁盘/恢复/UTF-16/依赖契约保持不变。已移除仅供测试间接使用、会触发生产 Clippy `unused_imports` 的 `TextChange` facade re-export，现由测试直接引用 `types::TextChange`；未增加 allow 或放宽门禁。当前最终 HEAD 将重新执行完整 Rust/Clippy/Node/Browser/Build 验证，通过前不收口、不进入 R11-03。详情见 [R11-02](docs/R11-02-DETAILS.md)。
