# Markdown Editor

Stage 11 R11-06 正在把快照哈希（FNV-1a64）、字节数/哈希校验与元数据构建/解析从 `document_store.rs` 提取到 `snapshot/integrity.rs`、`snapshot/metadata.rs`。本地 Rust/Node/架构/构建验证已通过，真实 CI 尚未推送验证；Stage 10 兼容门禁冻结不变。历史见 [docs/README.md](docs/README.md)，详情见 [R11-06](docs/R11-06-DETAILS.md)。
