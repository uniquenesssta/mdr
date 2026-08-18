# Markdown Editor

模块化 Markdown 编辑器；Stage 11 已推进到 R11-01：已冻结当前 Rust 文档存储二进制兼容夹具，覆盖 A/B 快照、meta、journal、截断日志、损坏槽及中文/Emoji/UTF-16。为满足任务书要求的全量 `cargo clippy --all-targets -- --deny warnings` 硬门禁，已按授权清理 Stage 10 遗留的 2 个纯 lint 问题：删除 `src-tauri/src/document_store.rs` 测试模块中的重复 `Write` 导入，并将 `src-tauri/src/web_fetch.rs` 的等价 `format!` 写法改为内联参数。未改变 Tauri command、Serde DTO、磁盘格式、恢复/UTF-16 语义、网络请求行为或依赖；R11-02 Types 未提前实施。R11-01 精确 CI 正在对该提交树重新执行完整 Rust/Node/Architecture/Browser/Build 门禁，通过前不收口、不进入 R11-02。项目记录见 [docs/README.md](docs/README.md)，本任务验证见 [docs/R11-01-DETAILS.md](docs/R11-01-DETAILS.md)。
