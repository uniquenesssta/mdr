# R10-01 — Save Status Store

Atomic 10.1 将保存/加载状态从经典脚本的局部变量与 DOM 反推中迁出，建立 `src/features/persistence/state/save-status-store.js` 作为唯一状态权威，并通过 `src/features/persistence/index.js` 暴露公共契约。状态集合冻结为 `idle / queued / saving / saved / error / loading`；`destroy()` 为不可逆终态，销毁后读、写、订阅均拒绝继续执行。Store 只保存状态元数据，不复制 manifest、正文、DocumentModel 或 native session 数据。

## 实际实现与影响范围

新增 SaveStatusStore、最小 Persistence 公共入口及 scoped classic compatibility port。`src/main.js` 在组合根创建 Store，把现有 NativeDocumentStore 的状态事件归一化后提交给 Store，并负责取消订阅、销毁 bridge 与 Store。`public/app/core.js` 删除 `saveStatusState` 与 `setSaveStatus()` 权威实现；保存提示、分段加载提示只订阅 Store，原 raw native 监听仅保留 manifest 的 Outline/统计数据处理。`public/app/export.js` 的自动保存、手动保存和当前文件保存只通过 scoped port 提交状态意图。生产模块清单从 381 精确更新为 384，Stage 1 测试中的“当前 migration baseline”精确断言同步为 384；历史 Stage 1 的 67 模块事实没有修改。未修改冻结模型、Rust `document_store.rs`、持久化格式、平台 DTO、依赖或锁文件，也未提前实施 R10-02 及后续 Controller/Queue/Loader 职责。

外部可观察保存文案、自动保存关闭提示、native 分块保存进度、加载索引/正文进度、保存失败和加载失败提示保持既有语义。Native save/load 的异步过时与取消仍由现有 NativeDocumentStore 的 load sequence/session queue 保证；R10-01 Store 只接收已归一化事件并携带 documentId、targetVersion/backendVersion/version、pending、progress 与单调 revision，不新增第二套异步调度。

## 验证记录

Bootstrap workflow run `32036188566` 在发布提交前对同一工作树实际执行并通过：`npm audit --audit-level=high`；R10-01 targeted **5/5**；完整 `npm test` **240/240**；`verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record`；Browser contract **10/10**；`npm run build`；built-app browser **29/29**；`git diff --check`。生产模块清单由 381 增至 384，新增的 3 个 production modules 均已分类。

独立只读 R10-01 门禁 run `32036335321` 已在代码与最终门禁提交 `0de20ebd57a0ca6175162ed342ebfc4150db9e76` 上再次通过：scope/frozen/inventory guard、依赖审计、targeted **5/5**、Full Node **240/240**、Architecture/Documentation、Browser contract **10/10**、Production build、Built-app **29/29**、tracked tree clean 全部 PASS。本记录的文档收口提交仅修改本文件，随后仍由同一只读门禁复验；该后续 run ID 保留在 GitHub Actions 证据链中，不再写回文档，以避免“记录自身 run ID”造成无限文档提交/触发循环。

`npm run test:integration` 未执行，因为当前 `package.json` 没有该脚本；已用完整 Node 回归、Browser contract 与 built-app browser 真实链路替代。Rust test/clippy/check 未执行，因为本 Atomic 未修改 Rust、Rust 接口、DTO 或持久化格式，并由 frozen diff guard 明确验证 `src-tauri/src/document_store.rs` 未变化。
