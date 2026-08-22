# Markdown Editor

Stage 11 R11-07 正在把快照写入顺序（内容/元数据/日志重置的 fsync/rename 顺序）与两槽加载从 `document_store.rs` 提取到 `snapshot/writer.rs`、`snapshot/loader.rs`。本地 Rust/Node/架构/构建验证已通过，真实 CI 尚未推送验证；Stage 10 兼容门禁冻结不变。历史见 [docs/README.md](docs/README.md)，详情见 [R11-07](docs/R11-07-DETAILS.md)。
