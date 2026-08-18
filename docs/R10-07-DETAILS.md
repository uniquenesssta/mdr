# R10-07 — Native Segmented Loader

Atomic 10.7 将 native 分段加载的 manifest → chunk 遍历、`contentChunks` 组装、加载进度、逐段 yield 与取消 token 从旧 `src/storage/native-document-store.js` 抽离到 `src/features/persistence/native-document-store/native-segmented-loader.js`。Loader 仅持有 load sequence/token，不拥有 SaveSession、SaveQueue、SnapshotUploader、Search 或文档模型正文状态。

兼容语义保持不变：平台具备 `loadManifest` + `readChunk` 时按 512 KiB byte chunk 读取，保留 `loading-index / manifest / loading / loaded / load-error` 外部事件与 `contentChunks + segmented` 结果；平台不支持分段接口时仍回退 `documentStore.load`。`cancelPrevious !== false` 的当前加载使用单调 cancellation token，新加载或 `cancelLoad()` 会使旧 token 失效并抛出既有 `DOCUMENT_LOAD_CANCELLED`；隔离加载继续保持既有非取消路径。

NativeDocumentStore 只在 Loader 返回仍有效的结果后更新 NativeSaveSession 并发布最终 `loaded`，因此迟到旧加载不能写入 Session 或进入后续激活链。R10-08 Native Search Adapter、Browser Repository、Load Controller、Close Save 与旧代码最终清理均未提前实施；冻结 DocumentModel、Rust `document_store.rs`、平台 DTO、持久化格式、`package.json` 和 lockfile 未修改。

验证：GitHub Actions run `32098959610` 已通过：R10-07 targeted 10/10、R10-06 11/11、R10-05 9/9、完整 Node 295/295、npm audit 0、Architecture/No-Legacy/Generated/README、Browser Contract 10/10、Production Build、Built-app Browser 29/29。冻结路径、package/lockfile 与 Rust `document_store.rs` 均未修改。`npm run test:integration` 当前不存在；本 Atomic 未改 Rust/DTO/持久化格式，因此未重复执行 Rust test/clippy/check。
