# R10-09 — Browser Repository

Atomic 10.9 新增 `src/features/persistence/browser/browser-document-repository.js`，把 browser fallback 的正文缓存、session 元数据以及旧 active snapshot Web Storage 读写从 Documents 的过渡 SessionDocumentRepository 中抽离。BrowserDocumentRepository 是这些 browser 数据的唯一权威 owner；它不依赖 NativeDocumentStore、DocumentModel、DOM、计时器或平台检测。

`nativeBacked` 记录现在在 browser session 序列化时始终删除 `content`，即使调用方记录或旧缓存意外携带全文，也只落元数据；legacy active snapshot 对 native-backed 文档同样主动删除 `md_editor_content`。非 native 文档继续从唯一 browser body cache 写入原有 key，原 key 名、当前文档 id、intentionally-empty 标记与错误报告语义保持不变。

现有 `SessionDocumentRepository` 保留 R10-10 前的过渡协调职责，但不再拥有 Web Storage key 或正文 Map：browser 路径全部委托 BrowserDocumentRepository，native load/save/delete 仍委托 NativeDocumentStore；native 成功保存/加载会清除 browser fallback body，native-backed 且 native 恢复失败又无 browser fallback 时仍停止打开，避免覆盖原文。main 通过 Persistence 公共入口组合并按依赖逆序销毁 BrowserDocumentRepository。

R10-10 Load Controller、R10-11 Close Save、R10-12 Classic Persistence Port 以及后续 cleanup 未提前实施；冻结 DocumentModel、Rust `document_store.rs`、Platform DTO、持久化格式、`package.json` 与 lockfile 未修改。生产模块清单由 393 增至 394。

验证：Atomic 10.9 targeted 10/10、R10-08 8/8、R10-07 10/10、R10-06 11/11、R10-05 9/9、Documents Session Controller unit、完整 Node 313/313、npm audit high 0、Architecture/No-Legacy/Generated/README、Browser Contract 10/10、Production Build、Built-app Browser 29/29、冻结路径与 clean tracked tree。`npm run test:integration` 当前不存在；本 Atomic 未修改 Rust/DTO/持久化格式，因此未重复执行 Rust test/clippy/check。
