# R11-02 — Document Store Types

- 实现：将 `NativeHeading`、`TextChange`、`DocumentTransaction`、保存/加载/manifest/chunk/search 请求响应，以及持久化 `JournalEntry` / `SnapshotMeta` 从 `src-tauri/src/document_store.rs` 迁入 `src-tauri/src/document_store/types.rs`。`document_store.rs` 继续作为当前阶段公共入口与未迁移职责的编排壳，通过显式 re-export 保持既有调用路径。
- 职责边界：`types.rs` 只依赖现有 `serde`，只拥有 serde-backed DTO、字段顺序、camelCase、默认值与纯序列化契约；不持有运行时状态，不执行文件 IO、Tauri command、恢复、校验、索引或存储编排。DTO 项保持 `pub`，字段使用 `pub(super)`，仅供父模块及后续同域子模块构造/读取，不扩大字段可见性。
- JSON 契约：新增 4 个 Rust 单元契约测试，分别冻结保存请求 camelCase/default、搜索请求 default、全部响应 DTO 精确 JSON 字段名/顺序/null 语义，以及 journal/snapshot meta 精确持久化 JSON。未增加 `Serialize`/`Deserialize` 派生能力，原 serde derive 集合保持不变。
- 兼容夹具：R11-01 的固定来源提交、来源 blob、磁盘夹具和格式声明均不变；其源码词法门禁现在同时读取 `document_store.rs` 与 `document_store/types.rs`，以便 serde 标注迁移后仍验证冻结格式词汇。
- 外部兼容：未修改 `src-tauri/src/main.rs`、Tauri command 名称/参数 camelCase、Cargo/package 依赖、磁盘路径、A/B snapshot、journal format/version、恢复文本、UTF-16、Mutex 作用域或网络语义。
- Facade 修正：首轮精确 CI run `32161625160` 已通过 scope/contracts guard、Rust format、JSON contracts 4/4、R11-01 compatibility 5/5 与完整 Rust tests；随后全量 Clippy 在 `document_store.rs` 的全量 `pub use types::{...}` facade 暴露可见性问题。根据实际 crate 边界，已将实际由 crate 调用的 DTO 改为 `pub(crate) use types::{...}`，不公开 `types` 子模块、不放宽字段、不增加 allow，也不改变 Tauri/Serde/磁盘运行时契约。该 run 的 cargo check、Node、architecture、browser、build 与 clean-tree 因 fail-fast 被跳过，不能计为通过。
- Guard 修正：第二轮精确 CI run `32163025483` 在 scope/contracts guard 即失败，因为工作流仍匹配旧的 `pub use types::{` 文本；其余验证因此全部跳过。只同步该断言为新的 crate 级 facade 入口，允许路径集合、冻结基线、Cargo/package/main/fixtures 不变约束均未放宽。
- 第三轮验证：精确 CI run `32163214320` 已通过 scope/contracts guard、Rust format、JSON contracts 4/4、R11-01 compatibility 5/5 与完整 Rust tests；全量 `cargo clippy --all-targets -- --deny warnings` 随后仅报 `document_store.rs` 中 `TextChange` 的 crate re-export 未被非测试生产目标使用。cargo check、Node、architecture、browser、build 与 clean-tree 因 fail-fast 被跳过，不能计为通过。
- Clippy blocker 修复：不增加 `allow`、不降低 Clippy 门禁，也不删除 DTO。`TextChange` 仍被 `DocumentTransaction` 与现有 Rust UTF-16/恢复测试使用；将其从会触发未使用检查的 crate 级 re-export 集合拆出为 `pub use types::TextChange;`，保持 R11-01 前既有的 `document_store::TextChange` facade 路径，其余实际由 crate 调用的 DTO 继续使用 `pub(crate)` re-export。该修改不改变 Serde JSON、命令参数、磁盘字节、恢复/UTF-16 语义、Mutex 边界或依赖。
- 工作流：已冻结已收口的 R11-01 workflow 为仅手动复验其最终提交 `6cdff0cb98982e7604053d6ec0c0df7c0991e2fd`，避免后续 Atomic 合法修改被旧 scope guard 误判；R11-02 workflow 仅允许本 Atomic 的明确文件范围，并执行 JSON 4/4、R11-01 兼容 5/5、完整 Rust、Clippy/check、Node、architecture、browser 与 build 门禁。针对本次 facade 修复，Rust format gate 同时检查 `document_store.rs`、`types.rs` 与兼容测试。
- 当前验证：`TextChange` facade 修复与 README/本记录已进入同一 Stage 11 分支，正在对最终提交树重新执行完整硬门禁；全部通过前不收口，不进入 R11-03。
- 未提供：`npm run test:integration` 当前 package scripts 不提供该命令；本 Atomic 使用真实 Rust DTO/兼容夹具及完整 Rust/Node/Browser/Build 回归作为替代门禁。
