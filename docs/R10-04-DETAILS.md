# R10-04 — Native Save Session

Atomic 10.4 将每文档 native 持久化元数据从旧 `src/storage/native-document-store.js` 抽离到 `src/features/persistence/native-document-store/native-save-session.js`。NativeSaveSession 现在唯一拥有 `backendVersion`、`lastEditorVersion`、已持久化标题、`initialized` 与当前 source 引用；它不保存正文、快照、transactions、save waiters、timer 或平台对象。

旧 NativeDocumentStore 保持现有公开调用语义，只通过 Persistence 公共入口创建 NativeSaveSession。文档 activate、native load、VERSION_MISMATCH 回退与持久化成功后的 `markPersisted` / `acknowledge('storage')` 均改为由 Session 的明确方法维护同一份状态。R10-05 的 queue/running/waiters/forceSnapshot 责任仍留在旧 NativeDocumentStore 的局部 runtime 中，没有提前迁移 Save Queue；Uploader、Segmented Loader、Recovery、CloseSaveController 也未实施。

NativeSaveSession `destroy()` 为幂等终态，会释放 source 引用并拒绝后续状态更新，从而阻止已销毁 Session 的迟到结果重新提交。删除 native 文档时对应 Session 同步销毁。现有 title-only save、未变化版本/标题 skip、native 版本递增、DocumentModel storage consumer 注册与持久化确认语义保持不变。冻结 DocumentModel、Rust `document_store.rs`、平台 DTO、持久化格式、依赖与 lockfile 未修改。

Bootstrap workflow run `32042416333` 在实施提交前先对旧 NativeDocumentStore 的 native 激活、skip、title-only save 与版本确认行为执行基线验证；随后实际通过 R10-04 targeted **8/8**、完整 Node **265/265**、`npm audit --audit-level=high` **0 vulnerabilities**、Architecture/no-legacy-runtime/generated-files/README 门禁、Browser contract **10/10**、`npm run build`、built-app browser **29/29**，并确认 frozen diff 与最终 tracked tree 仅包含预期变更。永久 R10-04 gate 会在最终提交上再次执行同一组只读验证。

项目仍没有 `npm run test:integration`，因此未执行该不存在的脚本；完整 Node、Browser contract 与 built-app browser 作为当前可执行的前端集成/回归链。Rust test/clippy/check 未重复执行，因为本 Atomic 不修改 Rust、Rust 接口、DTO 或持久化格式，并由 frozen diff guard 验证 `src-tauri/src/document_store.rs` 保持不变。
