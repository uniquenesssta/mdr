# R11-02 — Document Store Types

- 实现：将 `NativeHeading`、`TextChange`、`DocumentTransaction`、保存/加载/manifest/chunk/search 请求响应，以及持久化 `JournalEntry` / `SnapshotMeta` 从 `src-tauri/src/document_store.rs` 迁入 `src-tauri/src/document_store/types.rs`。`document_store.rs` 继续作为当前阶段公共入口与未迁移职责的编排壳，通过显式 re-export 保持既有 `document_store::*` 类型路径。
- 职责边界：`types.rs` 只依赖现有 `serde`，只拥有 serde-backed DTO、字段顺序、camelCase、默认值与纯序列化契约；不持有运行时状态，不执行文件 IO、Tauri command、恢复、校验、索引或存储编排。字段改为 `pub(super)` 仅用于保持原来“document_store 模块及其后续子模块可访问、模块外不可访问”的有效可见性。
- JSON 契约：新增 4 个 Rust 单元契约测试，分别冻结保存请求 camelCase/default、搜索请求 default、全部响应 DTO 精确 JSON 字段名/顺序/null 语义，以及 journal/snapshot meta 精确持久化 JSON。未增加 `Serialize`/`Deserialize` 派生能力，原 serde derive 集合保持不变。
- 兼容夹具：R11-01 的固定来源提交、来源 blob、磁盘夹具和格式声明均不变；其源码词法门禁现在同时读取 `document_store.rs` 与 `document_store/types.rs`，以便 serde 标注迁移后仍验证冻结格式词汇。
- 外部兼容：未修改 `src-tauri/src/main.rs`、Tauri command 名称/参数 camelCase、Cargo/package 依赖、磁盘路径、A/B snapshot、journal format/version、恢复文本、UTF-16、Mutex 作用域或网络语义。
- 工作流：已冻结已收口的 R11-01 workflow 为仅手动复验其最终提交 `6cdff0cb98982e7604053d6ec0c0df7c0991e2fd`，避免后续 Atomic 合法修改被旧 scope guard 误判；新增 R11-02 workflow，仅允许本 Atomic 的明确文件范围，并执行 JSON 4/4、R11-01 兼容 5/5、完整 Rust、Clippy/check、Node、architecture、browser 与 build 门禁。
- 当前验证：实现提交完成后执行精确 R11-02 CI；完整硬门禁通过前不收口，不进入 R11-03。
- 未提供：`npm run test:integration` 当前 package scripts 不提供该命令；本 Atomic 使用真实 Rust DTO/兼容夹具及完整 Rust/Node/Browser/Build 回归作为替代门禁。
