# Stage 5 / Atomic 5.5 — CodeMirror Adapter

## 状态

- 当前状态：PASS。
- 基线：`1f910e1482f7ffce4bd66f921ab3e36d45ab30ea`（Atomic 5.4 最终 HEAD）。
- 验证候选提交：`1acab60bf7c97035ad61a28cd078a9eaba654736`。
- 候选完整验证：GitHub Actions run `31313703837` SUCCESS。
- 正式实现提交：`bfce4064f2d14403f1caccc2612c1ae5623d3af3`。
- 正式实现验证：GitHub Actions run `31313986683` SUCCESS。
- Atomic 5.6 尚未实施。

## 任务边界

Atomic 5.5 仅建立 CodeMirror Adapter 边界，封装 state/view、文本切片、事务、选择、焦点、滚动、历史、订阅与 destroy。其他 feature 不再获取或依赖 CodeMirror 实现对象。

本任务没有提前实施 Atomic 5.6 Extension Registry、5.7 Pointer Selection、5.8 Editor Controller 或 5.9 独立 History Adapter。

## 实现结果

### CodeMirror Adapter

新增：

- `src/editor/codemirror/codemirror-adapter.js`
- `src/editor/codemirror/index.js`

Adapter 私有持有真实 `EditorState` / `EditorView`，对外只提供中性编辑器 API：

- 文本读取、长度、行数与切片；
- 事务与范围替换；
- 查找与全量替换；
- selection 读取与设置；
- focus / blur / readOnly；
- scroll metrics、scrollTo/scrollBy、位置滚动与几何查询；
- history isolation、undo、redo；
- 不可变事务快照订阅与 scroll 订阅；
- 幂等且终态的 `destroy()`。

公开 adapter surface 不暴露 `view`、`state`、`scrollDOM`、`contentDOM`。监听器异常通过显式 reporter 报告，不回滚已经提交的编辑状态，也不阻断其他监听器。

### Virtual Editor 边界

`src/editor/virtual-editor.js`：

- 不再直接构造 `new EditorView(...)`；
- 不再直接调用 `EditorState.create(...)`；
- `host.virtualEditor` 只暴露中性 adapter API；
- 保留 textarea 兼容层、文档变更 journal 与当前扩展组合职责；
- 当前扩展重配/Hybrid 内部需要的 raw view 访问只存在于 editor feature 内部的 `integration` 边界，未暴露给其他 feature；
- 增加明确、幂等的 Virtual Editor destroy 生命周期。

扩展槽与 Compartment 仍留待 5.6 正式迁移，本任务没有把它们伪装成已完成的 Extension Registry。

### Scroll Sync 与生命周期

`public/app/scroll-sync.js` 不再读取：

- `virtualEditor.view.defaultLineHeight`
- raw `scrollDOM`
- raw `coordsAtPos`

改为使用 `getDefaultLineHeight()`、`getPositionCoordinates()`、`getScrollViewportRect()` 等中性 API。

`src/main.js` 明确持有 Virtual Editor 与 DocumentModel 生命周期，在现有 Documents 清理链中按顺序销毁；失败路径与重复销毁保持安全。

### E2E 探针迁移

初始完整 Built App 验证发现 3 条旧 E2E 探针仍直接依赖 `virtualEditor.view`：两条主题身份检查以及 trailing caret 坐标检查。它们与 Atomic 5.5 的验收条件直接冲突，因此没有恢复 raw `.view` 暴露，而是迁移到中性契约：

- 主题切换通过同一 `virtualEditor`、`getText()`、`getDocumentVersion()` 与 preview 节点身份确认编辑器/文档未重建；
- trailing caret 通过 `getPositionCoordinates()` 获取坐标；
- Pointer Selection 算法本身未修改，仍留待 5.7。

迁移后 Built App 20/20 PASS。

## 正式变更范围

5.5 正式实现提交相对 5.4 基线包含 9 个源码/测试文件，加 1 个 Stage 5 正式 workflow 文件：

1. `public/app/scroll-sync.js`
2. `src/editor/codemirror/codemirror-adapter.js`
3. `src/editor/codemirror/index.js`
4. `src/editor/virtual-editor.js`
5. `src/main.js`
6. `tests/architecture/fixtures/production-modules.json`
7. `tests/e2e/run-browser-tests.mjs`
8. `tests/stage-01-handoff.test.mjs`
9. `tests/unit/editor/codemirror-adapter.test.mjs`
10. `.github/workflows/stage-05-atomic.yml`

临时 `atomic-505-runner.yml` 与 `scripts/atomic505/*` 不属于正式变更范围，不进入 `rewrite/stage-05` 历史。

## 保持不变

- `src/document/document-model.js` 继续冻结，blob SHA：`d767d9025be05a6f6b87d7cd3527782db1c3303a`。
- Document Session / Recent Files 公共契约不变。
- 用户可观察的主题切换、编辑、滚动、选择、Hybrid、预览和文件行为保持现有语义。
- `package.json`、`package-lock.json` 与生产依赖未修改。
- `src/editor/hybrid/*` 与 `src/editor/precise-pointer-selection.js` 仍是 editor feature 内部 CodeMirror 使用者，分别由后续正式 Atomic 任务继续收敛；本任务没有无依据扩大范围。

## 架构清单

生产模块数量：252 → 254。

新增：

- `src/editor/codemirror/codemirror-adapter.js`
- `src/editor/codemirror/index.js`

## 验证

正式实现 HEAD `bfce4064f2d14403f1caccc2612c1ae5623d3af3` 的 Stage 5 run `31313986683` 实际通过：

- Stage 4 handoff：99/99；
- Atomic 5.1：7/7；
- Atomic 5.2：8/8；
- Atomic 5.3：11/11；
- Atomic 5.4：7/7；
- Atomic 5.5 CodeMirror Adapter：8/8；
- Frozen DocumentModel：PASS；
- Architecture：PASS；
- Node regression：42/42；
- Browser Contract：10/10；
- Build：PASS；
- Built App：20/20；
- evidence artifact：`stage-05-codemirror-adapter-31313986683-1`，artifact ID `9038196149`。

Build 仍产生既有 Vite chunk-size warning，但构建成功。依赖准备仍报告既有 4 个 npm audit 项（2 moderate、2 high）；5.5 没有修改依赖或 lockfile，因此本任务未声称修复这些既有项。

GitHub Actions 还报告 actions/checkout、setup-node、upload-artifact 的 Node 20 runtime deprecation warning；该提示来自 GitHub Actions action runtime，不是 5.5 产品代码失败，本任务未通过放宽门禁掩盖它。
