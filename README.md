# Markdown Editor

Stage 11 R11-03 正在将文档 ID、版本与 UTF-16 事务范围校验，以及文档目录/快照/日志/上传文件名布局，从 `document_store.rs` 提取到 `validation.rs` 与 `paths.rs`。错误文本、JSON/Tauri、磁盘格式、恢复、UTF-16、Mutex 与依赖契约保持不变；R11-02 已收口。完整硬验证通过前不进入 R11-04。历史见 [docs/README.md](docs/README.md)，详情见 [R11-03](docs/R11-03-DETAILS.md)。
