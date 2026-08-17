# R10-03 — Autosave Controller

Atomic 10.3 将自动保存从经典脚本迁入 `src/features/persistence/application/autosave-controller.js`。AutosaveController 单独拥有 debounce timer、Settings 的 enable/delay 运行投影、Autosave 调度代次与最近一次成功自动保存的文档 ID/模型版本/标题标识；正文仍由冻结 DocumentModel 唯一拥有，不缓存第二份正文。

自动保存统一通过 R10-02 SaveController 触发。连续请求只保留一个 debounce timer；同一文档在模型版本与标题均未变化时跳过冗余保存，标题变化即使版本不变仍会保存。Settings 关闭自动保存会立即取消待执行 timer；重新启用或 delay 变化会按提交后的 Settings 重新调度。真实失败、stale/cancel 与 destroy 后完成保持区分，不建立伪造的成功基线。

新增 scoped `classic-autosave-controller-port.js`，只向尚未迁出的经典调用者提供 `schedule()` 与 `cancelPending()`。`public/app/export.js` 已移除 `saveTimer`、`autoSave()`、`showSaveHint()` 和自行写 SaveStatusStore 的自动保存实现；Editor UI 的 `requestAutoSave`、`core.js`、`events.js` 与外部文档打开路径均通过 scoped Autosave port 请求调度或取消。自动保存设置仍由 Settings Store 唯一拥有。R10-11 的关闭前最终保存仍保留原 `saveCurrentDocumentState(...forceSnapshot)` 路径，本 Atomic 只把关闭前的待执行 autosave 取消切到 AutosaveController。

冻结模型、Rust `document_store.rs`、持久化格式、平台 DTO、依赖和锁文件均未修改；没有提前实现 Native Session、Save Queue、Uploader、Segmented Loader 或 CloseSaveController。生产模块清单由 386 增至 388。

永久 R10-03 workflow run `32040373089` 在实现 HEAD `1e4fe070c5f9a9d5ee195b50f00157965767cd0a` 上实际通过：R10-03 targeted **9/9**；完整 Node **257/257**；`npm audit --audit-level=high` 为 **0 vulnerabilities**；Architecture、no-legacy-runtime、generated-files、README 门禁全部 PASS；Browser contract **10/10**；`npm run build` PASS；built-app browser **29/29**；最终 tracked tree clean。R10-01 回归 run `32040373023` 与 R10-02 回归 run `32040373041` 在同一实现 HEAD 上也全部 PASS。

实施期间临时 bootstrap 仅用于把 GitHub connector 无法直接 patch 的多文件改动装配并在提交前验证，最终实现树已清除所有 `.agent/r10_03_*` 与 bootstrap workflow 临时文件。一次预提交 push 因 GitHub Actions token 不具备 workflow 写权限被拒绝，但该次代码验证本身已经 9/9、257/257、audit 0、Architecture PASS；随后通过仓库连接器写入同一已验证 tree，并由永久 workflow 再次完整复验，因此没有将推送权限失败描述成产品验证通过。

项目当前没有 `npm run test:integration`，因此该命令未执行；完整 Node、Browser contract 与 built-app browser 覆盖了本 Atomic 的可执行前端链路。Rust test/clippy/check 未重复执行，因为本 Atomic 未修改 Rust、Rust 接口、DTO 或持久化格式，且 frozen diff guard 明确确认 `src-tauri/src/document_store.rs` 无变化。GitHub runner 仅有 actions/checkout@v4、setup-node@v4 的 Node 20 runtime 弃用提示，当前工作流使用 Node 22 测试并全部通过，该提示不属于产品失败。
