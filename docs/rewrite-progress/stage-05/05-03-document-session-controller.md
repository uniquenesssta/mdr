# Stage 5 / Atomic Task 5.3：Document Session Controller

## 状态

- 当前状态：PASS（正式发布前 clean-runner 将从精确 5.2 基线重新验证本记录对应候选）。
- 基线：`d3d529c4b6f35f56577dce787c64c15bf01518dd`（Atomic 5.2 最终 HEAD）。
- 完整临时候选验证：GitHub Actions run `31309246707`。
- 受控 clean-runner：`31309523190`。
- Atomic 5.4 尚未开始。

## 任务边界

本节点只迁移文档生命周期协调：新建、打开/激活、外部导入、复制、保存、重命名、文件路径绑定与关闭，以及这些流程必须共享的正文兼容持久化与异步 generation/token。Recent Files 的 Repository、去重、上限、失败策略属于 Atomic 5.4，本节点未迁移。

冻结 `src/document/document-model.js` 不修改；DocumentSessionStore 继续是 metadata-only records/activeId 的唯一状态权威；DocumentModel 继续拥有当前活动正文、版本、dirty 与 transaction journal。

## 实施结果

### Document Session Controller

新增 `src/features/documents/application/document-session-controller.js`，成为文档生命周期业务编排权威：

- 统一 new/open/import/duplicate/save/rename/path-bind/close；
- 只拥有 lifecycle `generation` 与 destroy 状态，不复制 records、activeId 或正文；
- 每个会改变文档生命周期的操作先递增 generation，并取消旧 lifecycle native load；
- 异步 continuation 在模型激活、Session 提交、native metadata 提交和 UI 可见结果返回前校验 generation；
- stale 结果抛出明确 `DOCUMENT_OPERATION_STALE`，不得覆盖更新操作；
- save/read 使用捕获的 generation，若期间发生新 lifecycle 操作，其异步结果不能再提交 native metadata 或驱动旧 UI；
- `destroy()` 使 Controller 终止并使未完成操作全部 stale。

### Open / Close / Title 协调模块

职责继续拆分为独立模块：

- `document-open-coordinator.js`：负责现有文档和新文档的正文激活、native metadata handoff 与 Session commit 顺序；
- `document-close-coordinator.js`：关闭活动文档前先装载并激活确定的相邻文档，generation 仍有效后才提交 Session remove/activeId；
- `document-title-controller.js`：统一 rename 与 file-path metadata 提交，并同步活动 DocumentModel title；
- `classic-document-controller-port.js`：仅把 Controller 契约挂到既有 scoped compatibility host，不复制 lifecycle/session/model 状态，也不新增 `window.*` 业务全局。

每个实例都有明确 destroy 语义。

### Session Document Repository

新增 `src/features/documents/infrastructure/session-document-repository.js`，接管 5.2 明确登记的 classic persistence compatibility content cache：

- 唯一拥有非 native 文档的兼容正文缓存；
- 负责现有 `md_editor_documents`、`md_editor_current_document`、`md_editor_content`、`md_editor_filename` 等兼容持久化 I/O；
- Session Record 仍严格 metadata-only，正文不会进入 DocumentSessionStore；
- native body 继续委托 NativeDocumentStore；
- read-only inactive-document 读取使用 isolated native load，不触碰 lifecycle cancel token；
- Repository 不拥有 records、activeId、DocumentModel 或 DOM。

因此 5.2 在 `core.js` 中保留的 `legacyDocumentContentCache` 已正式退出，不再存在第二套 classic body cache。

### Native load 并发边界

`src/storage/native-document-store.js` 的 `load(documentId, options)` 增加 `cancelPrevious:false` 的 isolated-read 模式：

- 生命周期 open/switch 保持旧行为：新的 lifecycle load 淘汰旧 load；
- export/duplicate 等只读加载不会取消正在进行的 lifecycle load；
- isolated read 也不会因为后续 lifecycle load 的 token 变化被错误判定为取消；
- Rust/Tauri document_store 协议、数据格式、snapshot/journal/search 未修改。

### Classic caller cutover

`public/app/core.js`：

- 删除 `legacyDocumentContentCache`；
- 删除 classic create/load/materialize/save-session/activate-runtime 等状态编排；
- new/open/duplicate/rename/close/save/lazy-create 只作为 UI wrapper 调用 Controller；
- inactive context export/save-as 通过 generation-guarded read contract；
- UI adapter 在 preview reset 等 await 前后校验 generation，stale 操作不再更新 filename/list/toast/statistics。

`public/app/export.js`：

- 导入 generation 在 FileReader/native read **之前**开始；
- 导入内容校验失败会恢复 Session 当前 runtime 文档；
- autosave/manual save/file save 在 await 后检查 generation，stale save 不再写 native metadata、绑定旧路径或显示旧 toast/status；
- file-path metadata 通过 Controller 提交。

`public/app/events.js`：

- filename input 不再直接调用 DocumentModel title mutation，而通过 Controller；
- native dropped-path 文本读取通过 generation-aware external-open loader，旧读取完成后不能覆盖新文档。

`src/main.js` 在 classic scripts 之前组合 Repository、Controller 与 scoped port，并为 classic 加载失败/pagehide 提供显式销毁路径。

## 失败、取消与回滚

- slower open 被 newer open/new/rename/close 超越：旧 promise 以 `DOCUMENT_OPERATION_STALE` 终止，不能提交 Session/model/UI；
- 外部文件读取尚未完成时用户发起新 lifecycle 操作：旧文件内容不能插入 Session；
- native save 在新 generation 后才完成：不能写回旧 `nativeBacked/nativeVersion`；
- active close 的 next-document load 过时：旧 close 不能删除原文档或切换 activeId；
- 导入在 DocumentModel 已激活后、Session commit 前校验失败：只在该 generation 仍为当前时恢复原 active runtime；若操作已 stale，则不得执行回滚覆盖新操作；
- isolated read 与 lifecycle load 互不误取消；正常 lifecycle load 仍保持 latest-wins；
- destroy 后 Controller/Repository/compatibility port 均终止。

## 保持不变

- `src/document/document-model.js` blob SHA：`d767d9025be05a6f6b87d7cd3527782db1c3303a`；
- DocumentModel 公共 API、正文算法、transaction journal、consumer acknowledgement；
- DocumentSessionStore metadata-only records/activeId 契约；
- 既有 document storage key 与兼容序列化 surface；
- 新建、打开、激活、复制、重命名、关闭、导入、保存、另存为的既有用户可观察语义；
- native document_store Rust/Tauri 协议与持久化格式；
- Preview、Theme、I18n、Help、Settings、Editor 公共接口；
- 生产依赖与 lockfile。

## 验证

完整临时候选 run `31309246707` 实际执行并通过：

- 5.3 新模块与 classic cutover JavaScript syntax；
- Stage 4 handoff 全专项；
- Atomic 5.1 Documents Domain；
- Atomic 5.2 Document Session Store；
- Atomic 5.3 Document Session Controller：11/11；
- frozen DocumentModel blob SHA；
- `npm run verify:architecture`；
- 完整 `npm test`；
- `npm run test:browser:contract`；
- `npm run build`；
- `npm run test:browser`，包含真实 Built App A/B 文档 new → switch → rename → save → close → empty 生命周期一致性检查；
- `git diff --check`。

正式发布 clean-runner 会从精确 5.2 HEAD 重新物化同一正式文件集合，替换本记录中的 run token 后重复全部门禁，并执行 exact-file guard；该 run 未成功前不得发布。

## 架构清单

Production module inventory：`244 → 250`，新增 6 个职责单一模块：

1. Document Session Controller；
2. Document Open Coordinator；
3. Document Close Coordinator；
4. Document Title Controller；
5. Session Document Repository；
6. Classic Document Controller Port。

没有新增生产依赖。

## 已知限制与后续边界

- Recent Files 仍由 classic 逻辑管理；路径去重、数量上限、Repository 与失败策略属于 Atomic 5.4。
- `classic-document-controller-port.js`、5.2 Session Port、5.1 Domain Port 都是剩余 classic caller 的过渡边界，后续相应 caller 退出后必须删除。
- SessionDocumentRepository 仍保存既有 browser/localStorage 兼容正文，这是现有持久化兼容责任，不是 Session Store 状态；未来持久化阶段可继续收敛，但不得回流到 classic core。
- Atomic 5.4 尚未开始。
