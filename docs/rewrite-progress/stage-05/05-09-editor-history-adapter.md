# Stage 5 / Atomic Task 5.9：History Adapter

## 状态

- 结果：**PASS**；正式发布只允许在本文档所在最终 tree 完成 Stage 0–5 + Windows 全链验证后执行。
- 正式父基线：`b5e847d54e6f28e7d315dd7e0f1b0274e586786b`（CR-05 正式 HEAD）。
- 实现候选：`7d17cd1de6fd4d7a79075b3fbc4785d867f31e83`。
- Stage 5 实现候选验证：GitHub Actions run `31379668414` — **SUCCESS**。
- Evidence：`stage-05-editor-history-adapter-31379668414-1`。
- Evidence ID：`9059366334`。
- Evidence digest：`sha256:871c16b8b43334f0a44e8ae14db917e79eda89aaa95a3852ed9f263e37da45f6`。
- Atomic 5.10：**未开始**。

## 任务书边界

本节点严格对应 `agent/plan/markdown-main-full-rewrite-taskbook-18-docs/06-阶段05-文档会话与编辑器基础.md` 的 Atomic 5.9：History Adapter。任务书要求本节点仅代理 CodeMirror `undo / redo / isolate`，并删除全文 `historyStack` 第二历史权威；不得提前实施 5.10 Formatting Commands、完整 Hybrid Editor 或后续 Editor UI。

本节点不修改冻结 `DocumentModel`，不新增独立 undo/redo 栈，不保存正文快照，不改变持久化、Rust/Tauri DTO、Settings、权限、安全策略或生产依赖。

## 原问题与调用链

5.9 实施前同时存在两套历史路径：

1. CodeMirror Adapter 已提供事务级 `undo()`、`redo()`、`isolateHistory()`；
2. classic app 仍保留 `historyStack / historyIndex / lastHistoryText / historyTimer / MAX_HISTORY / recordHistory()` 全文快照历史，并在 `bootstrap.js`、`events.js`、`editor-tools.js`、`core.js` 中维护；
3. `virtual-editor.js` 还保留 `documentLoadResetPending / consumeDocumentLoadHistoryReset() / resetHistory()` 兼容路径，CodeMirror integration 也额外公开 `resetHistory()`。

这会形成任务书明确禁止的第二历史权威和重复 reset-history 路径。

## 最终职责边界

### `src/features/editor/application/editor-history-adapter.js`

新增应用层中性 History Adapter：

- 仅接收 neutral EditorAdapter 依赖；
- 仅公开 `undo()`、`redo()`、`isolate()`、`destroy()`；
- `undo/redo/isolate` 分别委托 adapter 的 `undo/redo/isolateHistory`；
- 不导入 CodeMirror 包；
- 不持有正文、快照、history stack/index 或 selection 副本；
- `destroy()` 幂等并使后续调用终态失败，但不销毁注入的 EditorAdapter。

因此 CodeMirror transaction history 仍是唯一 history owner。

### `src/features/editor/compatibility/classic-editor-history-port.js`

新增 scoped classic compatibility port：

- host property：`markdownEditorEditorHistoryPort`；
- 仅公开 `undo / redo / isolate / destroy`；
- 不保存历史条目或正文；
- 重复 mount 拒绝；
- `destroy()` 仅删除自身 host property，幂等且不会销毁应用层 History Adapter。

### `src/features/editor/index.js` 与 composition

- `src/features/editor/index.js` 统一公开 `createEditorHistoryAdapter` 与 `mountClassicEditorHistoryPort`；
- `src/main.js` 在 Virtual Editor / DocumentModel / Editor Controller 建立后创建 History Adapter，并把 History port 纳入失败回滚和逆序销毁；
- classic 调用者只通过 feature 公共边界取得 history 能力。

## 第二历史权威删除

以下 classic 全文历史状态/逻辑已全部删除：

- `MAX_HISTORY`；
- `historyStack`；
- `historyIndex`；
- `lastHistoryText`；
- `historyTimer`；
- `recordHistory()`；
- `resetHistoryForCurrentDocument()`；
- `events.js` 的 400ms 全文 history timer；
- `bootstrap.js` 的全文 history 初始化。

`public/app/editor-tools.js` 保留现有 `pushHistory()` 这个格式命令 helper 名称，但其职责已变为单纯调用 `editorToolsHistoryPort.isolate()`；undo/redo 只通过 History Adapter port 执行，并继续保留原有 preview/count/autosave/focus/toast 后置行为。

## Document load / CodeMirror reset 收敛

`src/editor/virtual-editor.js` 删除：

- `documentLoadResetPending`；
- `consumeDocumentLoadHistoryReset()`；
- public `resetHistory()`。

`codemirror-editor-adapter.js` integration 删除额外 `resetHistory()`。文档替换继续通过既有 `resetDocument()` 创建全新的 CodeMirror `EditorState`；专项测试确认新文档状态不会继承上一文档 undo history，因此无需第二个 reset-history compatibility path。

## 模块与兼容性

- production module fixture：**261 → 263**，只新增 History Adapter 与 scoped classic History port 两个真实职责模块；
- Frozen `src/document/document-model.js` blob 保持 `d767d9025be05a6f6b87d7cd3527782db1c3303a`；
- 未新增生产依赖，dependency audit 为 0 vulnerabilities；
- 未修改 lockfile、Rust/Tauri、持久化格式、Settings key/default、安全策略或权限；
- Atomic 5.10 未开始。

## 测试与永久门禁

新增：

- `tests/unit/editor/editor-history-adapter.test.mjs`：覆盖 delegate、contract validation、错误透传、destroy terminal、scoped port mount/destroy；
- `tests/architecture/stage-05-history-authority.test.mjs`：禁止 classic 全文历史权威回归，要求 classic undo/redo/isolate 只经 History port，并禁止重新引入 reset-history compatibility path；
- `.github/workflows/stage-05-atomic.yml` 新增独立 `Verify Atomic Task 5.9 History Adapter` 门禁，Stage 5 job 改为 `Verify Stage 5 Through History Adapter`，evidence 改为 5.9 History Adapter artifact。

原 5.1–5.8、CR-05、Frozen DocumentModel、Architecture、Node、Browser Contract、Build、Built App 门禁全部保留，没有删除、跳过或弱化。

## 实施与验证记录

### 前置行为与失败先证

临时 isolated runner 先执行既有 CodeMirror Adapter history 测试，确认旧事务历史行为可复现；随后创建 5.9 新 contract tests 并在旧实现上验证它们**按预期失败**，失败点包括全文 `historyStack`、缺失 `editor-history-adapter.js`、旧 reset-history compatibility path 和缺失公共导出。

临时 runner 的第一版 workflow 在 GitHub Actions 解析阶段失败，0 job 执行，因此没有源码/测试结果；该临时定义被拆分为职责更清晰的 runner + materializer。

后续 materialization run `31379253210` 已成功先证并应用 5.9，但 focused gate 因临时 Python regex replacement 把测试里的 `\n` 写成真实换行而产生 JavaScript SyntaxError；History Adapter、History authority、Editor Controller 和 CR-05 contract 本身在该 run 已通过。候选未发布。仅修正临时 materializer 的 replacement semantics 后重新从同一正式基线执行。

### clean isolated runner

run `31379423476`：**SUCCESS**。

- dependency audit：0 vulnerabilities；
- 旧 CodeMirror history behavior：PASS；
- 5.9 contract pre-implementation failure：按预期复现；
- 5.9 focused contracts：PASS；
- Frozen DocumentModel hash：PASS；
- Architecture hard gate：PASS；
- Node regression：PASS；
- Browser Contract：PASS；
- Production Build：PASS；
- Built App regression：PASS；
- diff cleanliness：PASS。

该 runner 初次 clean candidate 中产生一个 `artifacts/stage-05/atomic-509-browser-app/responsive-shell-report.json` 测试输出；发布前 diff audit 将其识别为临时构建/测试产物并删除，没有进入正式候选 tree。

### 实现候选跨阶段验证

候选 `7d17cd1de6fd4d7a79075b3fbc4785d867f31e83` 通过：

- Stage 0 Baseline Verification `31379668404`：**SUCCESS**，包含 Node、Browser Contract、Build、Built App、`cargo test --locked`、`cargo check --locked`、extended Tauri Linux build、evidence 与 hard gate；
- Stage 1 Atomic Verification `31379668461`：**SUCCESS**；
- Stage 2 Atomic Verification `31379668406`：**SUCCESS**；
- Stage 3 Atomic Verification `31379668405`：**SUCCESS**；
- Stage 4 Atomic Verification `31379668501`：**SUCCESS**；
- Stage 5 Atomic Verification `31379668414`：**SUCCESS**，5.1–5.9、CR-05、Frozen DocumentModel、Architecture、Node、Browser Contract、Build、Built App 与 5.9 evidence 全部通过；
- Stage 3 Windows Window Automation `31379668423`：**SUCCESS**，真实 Windows 原生窗口自动化直接通过，无重跑。

### 首轮文档 HEAD 硬门禁

首个 README/05-09 文档闭环 HEAD `18e6256e101a82c91aab3f322aa7f78e78d1a5bc` 触发 Stage 0–5 + Windows 后，Stage 1/2/3/4/5 均在共享 Node regression 的 `tests/documentation-layout.test.mjs` 停止。Stage 1 日志确认在失败前 Lifecycle、Architecture、handoff、263-module inventory 均已通过；唯一失败为根 README 超出仓库要求的 120–360 字符长度区间，Node 为 **43/44**。未修改或放宽测试；仅把根 README 收敛为 347 字符，并保留 `docs/README.md` 与 05-09 验收记录链接。该失败不计为通过，修订后的最终文档 HEAD 必须重新执行完整门禁。

## 环境限制与发布约束

当前执行环境没有用户本地 Git checkout，且不能替用户检查其电脑工作区的未提交修改；因此本次远端实施使用精确正式 SHA、隔离分支、clean candidate、GitHub Actions 全链与发布前 tree/HEAD 核对替代本地工作区验证。

正式发布仅允许使用最终文档 HEAD 已完整验证的同一 tree，并压成一个以 `b5e847d54e6f28e7d315dd7e0f1b0274e586786b` 为唯一父提交的 Atomic 5.9 正式提交，再以 `force=false` fast-forward 到 `rewrite/stage-05`。Atomic 5.10 在 Atomic 5.9 正式闭环前保持未开始。
