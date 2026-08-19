# Markdown Editor

模块化 Markdown 编辑器。Stage 11 正在执行 R11-02：Serde DTO 已迁入 `document_store/types.rs`；针对 Clippy 暴露的 `TextChange` 未使用 crate re-export，已改为保持既有 `document_store::TextChange` 路径的公开 facade re-export，其余 DTO 仍为 crate 级入口。JSON、Tauri 命令、磁盘/恢复/UTF-16 语义及依赖不变。完整硬门禁重新验证中，全部通过前不收口、不进入 R11-03。详情见 [R11-02](docs/R11-02-DETAILS.md)。
