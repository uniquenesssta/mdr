# R10-08 — Native Search Adapter

Atomic 10.8 将大文档 native 搜索的 `documentId/query/from/wrap` 请求映射从旧 `src/storage/native-document-store.js` 抽离到 `src/features/persistence/native-document-store/native-search-adapter.js`。Adapter 只持有终态 lifecycle，不拥有文档正文、SaveSession、SaveQueue、SnapshotUploader、SegmentedLoader、DOM、计时器或平台之外的共享状态。

兼容语义保持不变：只有 NativeDocumentStore 可用、平台具备 `search` 且 documentId/query 非空时才调用现有 `search_document_state` 端口；`from` 继续按非负数归一化，`wrap` 仅在显式 `false` 时关闭。平台返回对象原样透传，因此 Rust 已计算的 UTF-16 `from/to`、`wrapped` 和后端 `version` 不在 JavaScript 再解释或转换；not-found `null` 与平台错误身份也保持不变。经典 Find 路径仍通过 `nativeStore.search(...)` 调用同一 NativeDocumentStore public API。

R10-09 Browser Repository、R10-10 Load Controller、Close Save 与最终 classic cleanup 均未提前实施；冻结 DocumentModel、Rust `document_store.rs`、Platform DTO、持久化格式、`package.json` 与 lockfile 未修改。生产模块清单由 392 增至 393。

验证：Atomic commit 生成前已执行旧搜索契约冻结、R10-08 targeted 8/8、R10-07 10/10、R10-06 11/11、R10-05 9/9、Stage 3 DocumentStore client 10/10、完整 Node 303/303、npm audit high 0、Architecture/No-Legacy/Generated/README、Browser Contract 10/10、Production Build、Built-app Browser 29/29、冻结路径与 clean tracked tree。`npm run test:integration` 当前不存在；本 Atomic 未修改 Rust/DTO/持久化格式，因此未重复执行 Rust test/clippy/check。
