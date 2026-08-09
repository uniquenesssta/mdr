# Stage 5 / Atomic 5.7 — Pointer Selection

## 状态

- 结果：**PASS**
- 正式基线：`2f63e1967305c4a558038eb0da59c55debf06dff`
- 正式实现提交：`7d1804fbc0cea904d4fb5d6e6d3b44eec35f0b1e`
- 正式 5.7 workflow 提交：`41424f38cb5d8f12b5c0352348864bb11fc469e5`
- 正式实现/workflow 验收 run：`31320361609` — SUCCESS
- 正式 evidence：`stage-05-pointer-selection-31320361609-1`
- Evidence ID：`9039988930`
- Evidence digest：`sha256:3b11285355d230b248394f352e64ab29586d282d2239328e52b13531b3a953c2`
- Atomic 5.8 Editor Controller：**未开始**
- Atomic 5.9 History Adapter：**未开始**

## 任务边界

Atomic 5.7 只处理 Pointer Selection。任务书要求把精确落点读取、边界解析、选择策略从旧的单文件实现中拆开，并保持编辑器基础设施职责边界；不得提前实现 5.8/5.9。

保持不变的既有行为包括：

- CodeMirror Extension Registry 继续是 pointer selection extension 的唯一装配者。
- `real pointer drag selects only the intended characters` Browser Contract 保持通过。
- Built App 中 `application pointer drag maps to exact editor characters` 保持通过。
- 单击、双击、三击、拖拽、跨行拖拽、多选语义不变。
- Hybrid widget/pointer 排除逻辑与纠正诊断语义不变。
- `src/document/document-model.js` 保持冻结。

## 重构前问题

`src/editor/precise-pointer-selection.js` 同时承担以下职责：

1. DOM/CodeMirror caret 与行几何读取；
2. `caretPositionFromPoint` / `caretRangeFromPoint` 兼容读取；
3. 最近 CodeMirror position 搜索；
4. pointer correction 判定；
5. 跨行拖拽边界规则；
6. 单击/双击/三击范围策略；
7. 多选 range 删除策略；
8. correction diagnostic 节流；
9. `EditorView.mouseSelectionStyle` 会话生命周期。

这些职责存在明确可拆边界，因此本 Atomic 不保留旧单文件或转发兼容层。

## 最终模块边界

### `src/editor/pointer-selection/caret-boundary-reader.js`

负责读取和测量，不拥有选择策略：

- document position clamp；
- 视觉目标 `.cm-line` 解析；
- pointer capture 下的几何行回退；
- 标准/兼容 native caret API；
- `coordsAtPos` position rect；
- pointer distance；
- 有界最近 position 搜索；
- 跨行 drag boundary 几何上下文。

### `src/editor/pointer-selection/pointer-selection-policy.js`

纯策略模块，不读取 DOM：

- 是否需要 pointer correction；
- 保留旧实现的跨行 `0.62` row threshold；
- cursor / word / whole-line click range；
- multi-range removal 与 main index 语义。

### `src/editor/pointer-selection/precise-pointer-selection.js`

负责会话编排：

- reader + policy 协作；
- correction diagnostic 节流；
- precise pointer position orchestration；
- CodeMirror `mouseSelectionStyle` session/update/get 生命周期。

### Extension Registry

`src/editor/codemirror/codemirror-extension-registry.js` 只把 import 切换到新的 pointer-selection 入口；`createPrecisePointerSelectionExtension()` 仍只装配一次。Pointer extension ownership 没有移回 Virtual Editor 或其他模块。

## 已删除旧实现

已删除 `src/editor/precise-pointer-selection.js`。没有建立转发文件、重复实现或无退出计划兼容层。

## 生产模块清单

生产模块数量：**255 → 257**。

原因：1 个旧 pointer 单文件删除，新增 3 个职责模块，净增 2 个模块。

架构清单同步更新为：

- caret/geometry reader：`editor-input` / `pure-with-view`
- selection policy：`editor-input` / `pure`
- precise selection orchestrator：`editor-input` / `editor-extension`

## Atomic 5.7 专项验证

新增 `tests/unit/editor/pointer-selection.test.mjs`，结果：**8/8 PASS**。

覆盖：

1. 同行且几何误差在阈值内时不纠正；
2. fallback/native 行漂移、无效几何和纵向误差触发纠正；
3. 上/下跨行拖拽保留旧 `0.62` 阈值；
4. 单击 cursor、双击 word、三击 whole-line 语义；
5. multi-range removal/main-index/final-range 语义；
6. 有界最近 CodeMirror position 搜索；
7. 标准 native caret API 通过 CodeMirror 映射；
8. 目录化、旧文件删除、Registry 唯一装配及职责隔离。

`tests/hybrid-source-highlight.test.mjs` 只同步到新的 pointer entry 路径，原有 `positionChanged || lineChanged` 断言保留，没有删除或放宽。

## 候选验证

临时分支：`agent/atomic507-runner`。临时 workflow/materializer 不进入正式历史。

### 首轮候选

Run：`31319489502`

先验证重构前 Built App：**21/21 PASS**；目录切换后 5.7 **8/8 PASS**、Stage 4、5.1–5.6、Frozen DocumentModel、Architecture 均通过。

随后 Node suite 因 `tests/hybrid-source-highlight.test.mjs` 仍硬读取已删除的旧路径 `src/editor/precise-pointer-selection.js` 而失败。该失败是迁移后的测试路径陈旧，不是 pointer 行为失败；后续 Browser/Build/Built App 按硬门禁规则未继续执行。

修复方式仅为让该测试读取新的 `src/editor/pointer-selection/precise-pointer-selection.js`，原断言保持不变。

### 权威候选

Run：`31319642479` — **SUCCESS**

- Artifact：`atomic-507-candidate-31319642479-1`
- Artifact ID：`9039797751`
- Digest：`sha256:5b39cb8d616be2fa0324dd5c6d90fc08060378d5255f3363b8650838c428dde3`

结果：

- npm audit：0 vulnerabilities
- 重构前 Build：PASS
- 重构前 Built App：21/21 PASS
- Atomic 5.7：8/8 PASS
- Stage 4：99/99 PASS
- Atomic 5.1–5.6：全部 PASS
- Frozen DocumentModel：PASS
- Architecture：PASS
- Node regression：PASS
- Browser Contract：PASS
- Build：PASS
- 重构后 Built App：21/21 PASS

因此 5.7 有同一 clean runner 上的重构前/后 Built App 对照，不仅依赖静态源码比较。

## 正式验收

正式 workflow 已从 5.6 Extension Registry 节点切换为 5.7 Pointer Selection 节点，同时保留：

- `npm audit --audit-level=low`
- 父级 `node_modules` KaTeX Vite dev 真实请求门禁
- Stage 4 handoff
- Atomic 5.1–5.6 回归
- Frozen DocumentModel SHA
- Architecture
- Node regression
- Browser Contract
- Build
- Built App

新增 5.7 专项：`node --test tests/unit/editor/pointer-selection.test.mjs`。

正式 run `31320361609` 全部 SUCCESS，evidence 上传成功。

## 依赖、兼容性与限制

- `package.json`：未修改。
- `package-lock.json`：未修改。
- 未新增生产依赖。
- 公共调用语义未修改。
- 配置/默认值/持久化/错误码/权限/安全策略未修改。
- Pointer correction 算法参数没有在本 Atomic 中重新调优；用户 Windows performance 日志中此前观察到的 `editor.pointer-position-corrected` 作为真实行为基线保留，5.7 的目标是模块职责拆分和行为冻结，不是改变选择结果。
- 5.8/5.9 未预实现。

## 本地验证

本 Atomic 不需要新增 Windows/Tauri 本机验证。Pointer Selection 的用户可观察路径由真实 Browser Contract 与重构前/后的 Built App 交互回归覆盖；此前 Windows/Tauri smoke 已在 5.6 后续修复中完成。
