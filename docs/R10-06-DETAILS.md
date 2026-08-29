# R10-06 — Native Snapshot Uploader

Atomic 10.6 将 native 大快照的分块边界、UTF-16 代理对保护以及 `begin / append / commit / abort` 生命周期从旧 `src/storage/native-document-store.js` 抽离到 `src/features/persistence/native-document-store/native-snapshot-uploader.js`。Uploader 只拥有活动上传元数据；正文仅作为一次上传调用的瞬态输入，不进入持久状态，也不复制 NativeSaveSession 或 NativeSaveQueue 的版本、标题、等待者和串行状态。

Uploader 保留现有 512K 分块启用阈值、256K 字符块大小、动态保存进度与分块间让步语义；分块边界不会拆开 UTF-16 代理对。只有平台同时提供 begin/append/commit/abort 四项能力时才启用分块上传。append、commit、显式取消或 destroy 均确保走 abort；abort 自身失败不再被静默吞掉，而会作为可观察的清理失败返回。删除文档会先终止该文档 Queue，再取消活动上传并执行 abort，随后销毁 Session 与删除 native 文档，迟到的上传结果不能继续 commit。

NativeDocumentStore 继续负责是否 reset、请求 DTO、VERSION_MISMATCH、Session 提交以及尚未迁移的 load/search 编排；R10-07 Segmented Loader、R10-08 Native Search Adapter、Browser Repository、Load Controller、Close Save 和旧代码最终清理均未提前实施。冻结 DocumentModel、Rust `document_store.rs`、平台 DTO、持久化格式、`package.json` 和 lockfile 未修改。当前生产模块清单为 391。

## 验证

候选实现永久只读门禁 run `32047917885` 全链通过：R10-06 targeted 11/11、R10-05 Queue 兼容回归 9/9、完整 Node 285/285、`npm audit --audit-level=high` 0 vulnerabilities、Architecture/No-Legacy/Generated/README 全部 PASS、Browser Contract 10/10、production build PASS、built-app browser 29/29、`git diff --check` 与 tracked-tree clean PASS。首个 targeted 候选曾因测试正则把模块头注释中的 `document.` 文本误判为 DOM 全局而 10/11；修正测试仅匹配真实 DOM 能力后，同一产品实现通过 11/11，未以削弱行为断言绕过失败。

`npm run test:integration` 不存在于当前 package scripts，因此未执行；已用完整 Node、Browser Contract 与 built-app browser 链路替代。R10-06 未修改 Rust、平台 DTO 或持久化格式，因此未重复执行 Rust test/clippy/check。当前执行环境本地容器无法解析 `github.com`，无法以本地 clone 的 `git status` 作为证据；GitHub Actions 在真实 checkout 上完成了 tracked-tree clean 门禁。最终 Atomic 收口后还需在压缩后的最终 HEAD 再执行同一永久门禁，最终报告以该次结果为准。
