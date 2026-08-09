# Stage 5 / Atomic 5.6 — CodeMirror Extension Registry

## 状态

**PASS**

Atomic 5.6 已建立独立 CodeMirror Extension Registry，并在不改变现有编辑、主题、Hybrid、文档切换与指针交互行为的前提下，将扩展装配与运行时重配置从 `virtual-editor` 中移出。

## 基线与正式提交

- Atomic 5.5 最终基线：`266080c8e9ab7be48306e172fedb209ca2133cf3`
- Atomic 5.6 正式实现提交：`85257acb728549fbe492e318f5d5710e5192f128`
- Atomic 5.6 正式 workflow 提交：`beea51f42de8ade225a0e08ddac8d2beedab82b0`
- 冻结 `src/document/document-model.js` blob：`d767d9025be05a6f6b87d7cd3527782db1c3303a`
- `package.json`、`package-lock.json` 与生产依赖未修改。

## 实际实现

新增 `src/editor/codemirror/codemirror-extension-registry.js`，由一个显式生命周期实例集中拥有任务书要求的五类扩展槽：

- Base：基础编辑行为、默认键位、history、精确指针扩展与内容属性。
- Markdown：Markdown/GFM 语言支持及既有 Enter/Backspace Markdown 编辑键位。
- Theme：可运行时重配的主题扩展槽；现有应用主题仍由既有 CSS/token 体系负责，没有引入第二套主题状态。
- Read-only：`EditorState.readOnly` 与 `EditorView.editable` 的统一只读配置。
- Hybrid：Hybrid presentation 与 table/code visual-editing 配置。

运行时扩展变化统一通过对应 `Compartment.reconfigure()` 提交。Registry 对无效重复设置进行 no-op 抑制；effect dispatch 失败时不会提前提交 Registry 状态；`destroy()` 幂等并使后续配置操作终止。

另外保留一个**内部 placeholder Compartment**。它不是第六个任务书业务槽，而是隔离动态 placeholder 重配的内部实现边界，避免仅改变 placeholder 时重建 Base 槽中的 history/keymap 等扩展，从而降低历史状态和编辑行为回归风险。

## `virtual-editor` 边界变化

`src/editor/virtual-editor.js` 已移除：

- `@codemirror/*` 直接导入；
- `Compartment` 创建；
- `.reconfigure()` 调用；
- `editorExtensions` 组合数组；
- presentation mode、Hybrid table/code visual-editing 的重复扩展状态；
- 文档 reset / history reset 后手工重新注入 Hybrid 配置的重复路径。

现在 `virtual-editor`：

- 从 `src/editor/codemirror/index.js` 创建 Adapter 与 Extension Registry；
- 用 `extensionRegistry.getExtensions()` 创建和重建 CodeMirror state；
- 将 Registry 连接到 Adapter 内部 effect dispatcher；
- placeholder、read-only、presentation mode 与 Hybrid visual-editing 配置通过 Registry 读写；
- 生命周期结束时先解除 Registry dispatcher，再销毁 Registry 与 Adapter。

因此 EditorState 重建时使用 Registry 当前配置快照，不再依赖 reset 后的第二次手工 reconfigure 回放。

## 公共入口与架构清单

`src/editor/codemirror/index.js` 继续保持最小 facade，并新增导出：

- `CODEMIRROR_EXTENSION_SLOT_NAMES`
- `createCodeMirrorExtensionRegistry`

生产模块清单从 **254 → 255**，新增的唯一生产模块为：

`src/editor/codemirror/codemirror-extension-registry.js`

对应 Architecture fixture 与 Stage 1 当前生产模块计数已同步更新。

## Atomic 5.6 专项验证

`tests/unit/editor/codemirror-extension-registry.test.mjs`：**8/8 PASS**。

覆盖：

1. Base / Markdown / Theme / Read-only / Hybrid 五类要求槽由单一 Registry 构造；
2. Read-only 通过 compartment effect 重配并抑制 no-op；
3. Hybrid mode 与 table/code visual-editing 共享统一配置所有权；
4. Theme slot 可重配且不暴露 raw CodeMirror View；
5. 当前扩展配置在 EditorState 重建后仍保持，无需手工 replay；
6. effect dispatch 失败不会提交 Registry 状态；
7. destroy 幂等且终止后续操作；
8. 生产集成中 `virtual-editor` 不再拥有 CodeMirror extension/Compartment/reconfigure 状态。

## 候选验证记录

### Run `31314934424`

候选产品验证已完整通过：5.6 专项、Stage 4、5.1–5.5、Frozen DocumentModel、Architecture、Node、Browser Contract、Build、Built App 均 PASS；evidence 也已上传。

该 run 最后仅在“把已验证候选推回临时分支”步骤失败：GitHub Actions token 没有 `workflows` 权限，GitHub 拒绝推送包含 `.github/workflows/stage-05-atomic.yml` 的提交。该失败发生在全部产品验证之后，不属于产品实现或测试失败，正式 PASS 未据此声明。

候选 evidence：

- `atomic-506-candidate-31314934424-1`
- Artifact ID：`9038461191`
- SHA-256：`890d5d5d96728a9ce1245709e39f253cd6797a74127c708bd3093b23fddc5f67`

### Run `31315032639`

调整临时发布机制后，重新从同一 Atomic 5.5 基线物化并执行完整候选链，结果 **SUCCESS**。临时 runner 仅推送已验证的六个非-workflow正式文件；正式 workflow 后续由 GitHub 连接器按同一已验证内容单独发布。

验证结果：

- Atomic 5.6：8/8 PASS
- Stage 4：99/99 PASS
- Atomic 5.1：7/7 PASS
- Atomic 5.2：8/8 PASS
- Atomic 5.3：11/11 PASS
- Atomic 5.4：7/7 PASS
- Atomic 5.5：8/8 PASS
- Frozen DocumentModel：PASS
- Architecture：PASS
- Node：42/42 PASS
- Browser Contract：10/10 PASS
- Build：PASS
- Built App：20/20 PASS

## 正式分支验证

正式 Stage 5 run：`31315268793`，HEAD `beea51f42de8ade225a0e08ddac8d2beedab82b0`，结果 **SUCCESS**。

实际结果：

- Stage 4：99/99 PASS
- Atomic 5.1：7/7 PASS
- Atomic 5.2：8/8 PASS
- Atomic 5.3：11/11 PASS
- Atomic 5.4：7/7 PASS
- Atomic 5.5：8/8 PASS
- Atomic 5.6：8/8 PASS
- Frozen DocumentModel：PASS
- Architecture：PASS
- Node：42/42 PASS
- Browser Contract：10/10 PASS
- Build：PASS
- Built App：20/20 PASS
- evidence upload：PASS

正式 evidence：

- `stage-05-extension-registry-31315268793-1`
- Artifact ID：`9038554569`
- SHA-256：`cbc72ec4eb2db3ad3717dd0c20a2030d07a0fec4da97e1b472a6c69062fd66aa`

## 保持不变的行为与契约

- `src/document/document-model.js` 保持冻结 blob 不变。
- 文本、事务、selection、focus、scroll 与 Adapter 公共中性契约不变。
- 现有 undo/redo/history 行为未在 5.6 拆分；history 仍留在既有 Adapter/Base 扩展链，独立 History Adapter 属于 5.9。
- 现有精确 pointer selection 算法未重构，仍由原 `precise-pointer-selection.js` 扩展提供；5.7 尚未开始。
- 现有 Theme Service/CSS token 行为不变；Registry 仅建立 CodeMirror theme extension slot，没有复制应用主题状态。
- Hybrid/source 模式、table/code visual editing、文档切换、主题切换和完整 Built App 行为均通过现有回归。
- 未新增 `window.*` 业务状态或新的生产依赖。

## 已知警告与限制

正式 CI 的 `npm run deps:prepare` 仍报告既有 **4 个依赖漏洞（2 moderate、2 high）**。Atomic 5.6 未修改依赖或锁文件，因此这些不是本任务引入的问题，也未在本 Atomic 中处理。

Vite Build 仍报告既有“大于 500 kB chunk”警告；Build 实际成功，本 Atomic 未通过放宽构建门禁隐藏该警告。

Atomic 5.6 只建立 Extension Registry。以下任务明确尚未开始：

- **5.7 Precise Pointer Selection**：精确坐标/指针算法重构；
- **5.8 Editor Controller**：编辑器业务协调；
- **5.9 History Adapter**：独立 undo/redo/history 边界。

5.6 不提前实施以上三个 Atomic。