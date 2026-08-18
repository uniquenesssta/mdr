# Markdown Editor

模块化 Markdown 编辑器。Stage 11 已进入 R11-02：serde 请求、响应与持久化 DTO 已迁入 `document_store/types.rs`，原 `document_store::*` 类型路径、Tauri 命令、JSON 字段/顺序/默认值、磁盘与恢复语义保持不变；新增精确 JSON 契约测试并继续复用 R11-01 兼容夹具。当前执行 Rust/Clippy/Node/browser/build 全链验证，通过前不进入 R11-03。详情见 [docs/README.md](docs/README.md) 与 [R11-02](docs/R11-02-DETAILS.md)。
