# R10-05 — Native Save Queue

Atomic 10.5 将同一文档 native 保存的 `running / waiters / forceSnapshot` 状态从旧 `src/storage/native-document-store.js` 抽离到 `src/features/persistence/native-document-store/native-save-queue.js`。NativeSaveQueue 现在唯一拥有串行执行、等待者合并、`forceSnapshot` 合并、失败 fan-out 与终态销毁；它不持有正文、snapshot、transactions、NativeSaveSession 的 backend/editor/title/source 状态、DOM、timer 或平台对象。

NativeDocumentStore 保留公开 API 和 native 请求组装职责，通过 Persistence 公共入口为每个文档创建一个 Queue，并把单批次持久化执行注入 Queue。版本相同且标题未变化的 idle skip 保持；同一批次覆盖的等待者共享结果；执行中的普通保存不会误吞后来到达的 `forceSnapshot` 请求，该请求会进入下一串行批次；执行期间到达的新标题/更高版本也不会被旧批次伪装为已保存。任何真实 batch 失败会一次性通知并拒绝该文档全部等待者。

Queue `destroy()` 为幂等终态：删除文档时先销毁 Queue、拒绝未完成等待者，再销毁 NativeSaveSession；已经发出的 native 调用若迟到返回，不再由 Queue 发布 saved/error。R10-06 Snapshot Uploader、R10-07 Segmented Loader、R10-08 Native Search Adapter 与后续 Browser/CloseSave 责任均未提前迁移；当前分块上传逻辑仍在旧 NativeDocumentStore 中。冻结 DocumentModel、Rust `document_store.rs`、平台 DTO、持久化格式、依赖和 lockfile 未修改。

Bootstrap workflow run `32045519711` 的 attempt 1 在 R10-05 targeted **9/9**、R10-04 compatibility **8/8**、完整 Node **274/274**、`npm audit --audit-level=high` **0 vulnerabilities** 和 Architecture/no-legacy-runtime/generated-files/README 门禁均通过后，仅 Browser contract 启动阶段因 GitHub runner Chromium 未暴露 page target 并伴随 DBus 诊断而失败；该次未把后续验证描述为通过。相同代码的 attempt 2 重跑成功：R10-05 targeted **9/9**、R10-04 compatibility **8/8**、完整 Node **274/274**、audit、Architecture/no-legacy-runtime/generated-files/README、Browser contract **10/10**、`npm run build`、built-app browser **29/29**、frozen diff、390 个生产模块和 tracked tree clean 全部通过。永久 R10-05 gate 会在最终 Atomic 提交上再次执行同一组只读验证。

项目仍没有 `npm run test:integration`，因此未执行该不存在的脚本；完整 Node、Browser contract 与 built-app browser 作为当前可执行的前端集成/回归链。Rust test/clippy/check 未重复执行，因为本 Atomic 不修改 Rust、Rust 接口、DTO 或持久化格式，并由 frozen diff guard 验证 `src-tauri/src/document_store.rs` 保持不变。
