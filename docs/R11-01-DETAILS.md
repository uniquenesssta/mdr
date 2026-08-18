# R11-01 — Document Store Compatibility Fixtures

- 实现：新增只读 Rust 兼容测试与提交夹具，覆盖 A/B snapshot/meta、journal、截断 journal、损坏槽以及中文/Emoji/UTF-16 搜索边界。
- 来源：夹具固定自 Stage 10 收口提交 `a49d89918a20251287df28583ab29d4b6eb4c1de`，对应 `src-tauri/src/document_store.rs` blob `af58efc8ac19672e7834b5cd8bab26fd202f85aa`。
- 兼容：未修改生产 Rust、Tauri command、Serde DTO、磁盘路径/字节格式、恢复消息、Mutex 边界或依赖；R11-02 Types 未提前实施。
- 验证：本文件先记录实现范围；最终验证结果在 R11-01 精确提交树通过永久工作流后补录。
- 未运行：`npm run test:integration` 当前 package scripts 不提供该命令；本 Atomic 以真实 Rust 夹具、完整 Rust/Node/Browser/Build 回归作为替代门禁。
