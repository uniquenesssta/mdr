# R10-02 — Save Controller

Atomic 10.2 新增 `src/features/persistence/application/save-controller.js`，把手动保存的标题、路径上下文、冻结模型版本/临时快照读取、DocumentSessionController 持久化委托、native/browser 结果归一化以及 SaveStatusStore 的 saving/saved/error 状态编排收口到单一 SaveController。Controller 不保存第二份正文；正文只在手动保存 continuation 需要写外部文件或兼容快照时从冻结模型即时创建一次临时 snapshot，最终结果不携带正文。

新增 scoped `classic-save-controller-port.js`，仅向尚未迁出的经典手动保存调用者暴露 `save()`，计划在 Atomic 10.12 与经典保存调用者一起删除。`src/main.js` 注入 DocumentSessionController、冻结 DocumentModel 和 R10-01 SaveStatusStore。`public/app/export.js` 的 `saveToLocal()` 与 `saveCurrentFile()` 不再直接调用 `saveCurrentDocumentState()`，也不再自行发布手动保存 saving/saved/error；外部文件写入和 picker 仍作为一次性 continuation 留在 export 边界。

本 Atomic 没有提前迁移自动保存与关闭前保存：`autoSave()` 的计时与 `saveCurrentDocumentState(false)` 保留给 R10-03，`eventsCloseSavePort` 的关闭前保存保留给 R10-11；没有创建 autosave-controller、Native Session/Queue/Loader。冻结模型、Rust `document_store.rs`、持久化格式、平台 DTO、依赖和锁文件未修改。生产模块清单由 384 增至 386。

Document operation stale、Controller 销毁后的晚到完成、file picker 取消与真实失败分开：过时/销毁不发布晚到成功或错误，picker 取消保留已完成的内部文档持久化并返回 cancelled；真实持久化或 continuation 异常进入 SaveStatusStore error 后继续交给既有 UI toast/perf 路径。

Bootstrap workflow run `32038508053` 对发布前同一工作树实际执行并通过：R10-02 targeted **8/8**；完整 Node **248/248**；`npm audit --audit-level=high`；架构门禁；Browser contract **10/10**；`npm run build`；built-app browser **29/29**；`git diff --check`。

永久只读验证 workflow 的首次 run `32038740183` attempt 1 在 targeted **8/8**、Node **248/248** 和架构/文档门禁均通过后，Chromium 尚未建立 CDP endpoint 即因 runner 环境启动失败终止，未执行任何 Browser contract case，因此该 attempt 未计为通过。对同一 HEAD 重跑该 job 后，attempt 2 完整通过：R10-02 targeted **8/8**、Node **248/248**、架构与文档门禁、Browser contract **10/10**、production build、built-app browser **29/29**、tracked tree clean。并行 R10-01 回归 run `32038740184` 也在同一 HEAD 完整通过，确认 R10-01 状态权威未被本 Atomic 回归破坏。

`npm run test:integration` 当前不存在，因此未执行；完整 Node、Browser contract 与 built-app browser 作为替代真实链路。Rust test/clippy/check 未执行，因为本 Atomic 未修改 Rust、Rust 接口、DTO 或持久化格式，且 frozen diff guard 明确确认 `src-tauri/src/document_store.rs` 未变化。
