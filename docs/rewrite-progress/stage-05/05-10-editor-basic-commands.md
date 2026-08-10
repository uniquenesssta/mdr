# Stage 5 / Atomic Task 5.10：Basic Formatting Commands

## 状态

- 结果：**PASS（实现候选已完成 Stage 0–5 + Windows 全链验证；正式发布仍须使用本文档所在最终 tree 再验证后执行）**。
- 正式父基线：`919aab0233f24262eeaffff1aa7ab0d19b9839ba`（Atomic 5.9 正式 HEAD）。
- clean 实现候选：`8896201e1582786034b26e80709f36c864e3be5e`。
- Stage 5 实现候选验证：GitHub Actions run `31399075076` — **SUCCESS**。
- Evidence：`stage-05-editor-basic-commands-31399075076-1`。
- Evidence ID：`9066878066`。
- Evidence digest：`sha256:2e16c09ebbcfefac52ab1505b18b1f186a8c84c152bed24d664e134cf21c66f4`。
- Atomic 5.11：**未开始**。

## 任务书边界

本节点严格对应 `agent/plan/markdown-main-full-rewrite-taskbook-18-docs/06-阶段05-文档会话与编辑器基础.md` 的 Atomic 5.10：Formatting Commands。

本节点仅迁移以下基础格式命令：

- 加粗；
- 斜体；
- 删除线；
- 标题；
- 引用；
- 无序列表、编号列表、任务列表；
- 行内代码与多行代码。

每个 command 模块只通过 neutral Editor Adapter 读取 selection/line/text 并提交一次 `replaceRange()` 编辑事务。Command 内部不刷新 preview、不保存、不调用 Toast、不访问 DOM/window/localStorage、不调用 History Adapter，也不导入原始 CodeMirror 包。

下划线、上下标、颜色、链接、图片、表格、数学、Mermaid、Find/Replace、完整 Hybrid Editor 和后续 Editor UI 均不属于 5.10，本节点未提前迁移。

## 原问题与调用链

Atomic 5.10 前，`public/app/editor-tools.js` 同时承担两类责任：

1. Markdown 文本变换：marker wrapping、标题前缀替换、引用/list 前缀、inline/fenced code；
2. UI workflow：history isolate、preview/count refresh、autosave、focus。

这导致基础业务变换继续滞留 classic 巨型工具文件，且命令无法在脱离 DOM/UI 的条件下独立测试。

5.10 将文本变换迁入 `src/features/editor/commands/`；`editor-tools.js` 只保留 classic UI wrapper，并通过 scoped Editor Command port 调用新命令。5.9 的 `pushHistory()` 仍只负责 History Adapter `isolate()`，preview/count/autosave/focus 仍位于 wrapper，行为顺序保持不变。

## 最终职责边界

### `src/features/editor/application/editor-command-service.js`

新增 Editor Command Service：

- 只依赖 neutral Editor Adapter；
- 验证 `getSelection / sliceText / getLineNumberAtPosition / getLineStart / getLineEnd / replaceRange` 契约；
- 组合四类基础 command 模块；
- 公开 `bold / italic / strikethrough / heading / quote / unorderedList / orderedList / taskList / inlineCode / code / destroy`；
- 不持有正文副本、selection 副本、history stack 或 preview 状态；
- `destroy()` 幂等，销毁后调用终态失败；
- 不销毁调用方注入的 Editor Adapter。

### `src/features/editor/commands/inline-format-commands.js`

只负责 `bold / italic / strikethrough` marker wrapping；每次调用只提交一次 replacement transaction。

### `src/features/editor/commands/block-format-commands.js`

只负责：

- `heading(level)`：1–6 级校验，保留旧实现对当前行已有 heading prefix 的替换语义；
- `quote(fallbackText)`：选区为空时使用 classic wrapper 提供的现有 i18n fallback，并保留逐行 `> ` 前缀行为。

### `src/features/editor/commands/list-commands.js`

只负责 unordered/ordered/task list prefix。迁移时保留旧实现“replacement 从选区首行 line start 开始”的既有 anchoring 语义，包括 mid-line selection 的历史行为，没有趁本节点改变用户可观察结果。

### `src/features/editor/commands/code-commands.js`

只负责：

- `inlineCode()`：反引号 wrapping；
- `code()`：多行 selection 使用 fenced code，单行 selection 使用反引号。

### `src/features/editor/compatibility/classic-editor-command-port.js`

新增 scoped classic compatibility port：

- host property：`markdownEditorEditorCommandPort`；
- 仅暴露 5.10 基础命令与 `destroy()`；
- 不持有正文、command state 或 history；
- 重复 mount 拒绝；
- `destroy()` 仅清理自身 host property，不销毁 Editor Command Service。

### composition / classic caller

- `src/features/editor/index.js` 统一公开 `createEditorCommandService` 与 `mountClassicEditorCommandPort`；
- `src/main.js` 创建 Service/port，并纳入失败回滚和逆序 destroy；
- `public/app/editor-tools.js` 的 5.10 wrapper 只执行：history isolate → explicit command port method → 原有 sync/preview/count/autosave/focus；
- list wrapper 使用三个显式端口方法，不保留字符串式动态 method dispatch；
- 颜色、链接、图片、表格等后续职责继续原路径，未扩大修改范围。

## 模块与兼容性

production module ownership fixture 从 **263 → 269**，新增六个真实职责模块：

- Editor Command Service；
- classic Editor Command port；
- inline format commands；
- block format commands；
- list commands；
- code commands。

冻结 `src/document/document-model.js` blob 继续保持 `d767d9025be05a6f6b87d7cd3527782db1c3303a`。

未新增生产依赖，未修改 lockfile、Rust/Tauri DTO、持久化格式、Settings key/default、安全策略、权限或错误语义。现有 classic function 名称继续保留给工具栏/快捷键/内联 compatibility caller，因此用户可观察入口和快捷键语义不变。

## 测试与永久门禁

新增：

- `tests/unit/editor/editor-command-service.test.mjs`：覆盖 inline/block/list/code 行为、legacy list anchoring、空选区 fallback、单事务提交、依赖校验、错误透传、destroy lifecycle 和 scoped port；
- `tests/architecture/stage-05-basic-command-boundary.test.mjs`：要求 5.10 模块位于计划边界，classic caller 必须经 command port，禁止 migrated transform 回到 `editor-tools.js`，并禁止 command layer 引入 preview/save/Toast/history/DOM/raw CodeMirror；
- `.github/workflows/stage-05-atomic.yml` 增加独立 `Verify Atomic Task 5.10 Basic Commands` 门禁并继续保留 5.1–5.9、CR-05、Frozen DocumentModel、Architecture、Node、Browser、Build、Built App 全部验证。

workflow 最终权限恢复为 `contents: read`；候选生成阶段使用的临时 materializer/repair 脚本均已从 clean tree 删除，未进入最终候选。

## 实施与失败先证

### 旧实现红灯

在新 5.10 tests/CI gate 建立、生产实现尚未创建时，候选 run `31397396809` 先通过 5.1–5.9，然后在 `Verify Atomic Task 5.10 Basic Commands` 按预期失败；缺失 Editor Command Service、command modules、classic command port/public exports，后续 CR-05/Architecture/回归均被 hard-stop。该 run 不计为通过。

### 首轮实施候选失败

为避免直接整文件覆盖巨型 `public/app/editor-tools.js`，隔离候选使用带精确 anchor/assertion 的临时 Node materializer 只迁移 5.10 函数块和 ownership fixture；materializer 成功提交 classic cutover 后，run `31398393836` 执行 5.10 tests：**8/9 PASS**。

唯一失败是架构测试要求 list callers 显式调用 `editorToolsCommandPort.unorderedList / orderedList / taskList`，而首轮 wrapper 使用 `editorToolsCommandPort[method]` 动态方法分派。行为测试和其他 5.10 contract 均已通过，但该 run 仍按失败处理，没有进入后续阶段。

修正没有删除或放宽测试，而是把三个 list wrapper 改为显式 command-port 调用，并抽取只含 UI 后置行为的 `finishBasicListCommand()`。随后删除临时 materializer/repair 文件、恢复 workflow `contents: read`，形成 clean candidate。

runner push 形成的若干中间 workflow 记录出现 0-job `action_required`；这些记录不代表验证通过，也未用于验收。最终 clean HEAD 由常规 connector commit 触发完整 PR 门禁。

## clean 实现候选全链验证

clean candidate `8896201e1582786034b26e80709f36c864e3be5e` 已通过：

- Stage 0 Baseline Verification `31399074942`：**SUCCESS**，含 Node、Browser Contract、Build、Built App、Rust tests/check、extended Tauri Linux build、evidence 与 hard gate；
- Stage 1 Atomic Verification `31399074905`：**SUCCESS**；
- Stage 2 Atomic Verification `31399074984`：**SUCCESS**；
- Stage 3 Atomic Verification `31399082786`：**SUCCESS**；
- Stage 4 Atomic Verification `31399075247`：**SUCCESS**；
- Stage 5 Atomic Verification `31399075076`：**SUCCESS**，5.1–5.10、CR-05、Frozen DocumentModel、Architecture、Node、Browser Contract、Build、Built App、5.10 evidence 全部通过；
- Stage 3 Windows Window Automation `31399078254`：**SUCCESS**，真实 Windows 原生窗口自动化通过。

相对正式 5.9 基线的 clean diff 仅包含 5.10 预期源码、测试、workflow 和 ownership fixture，没有临时脚本、构建/浏览器产物或 5.11 内容。

## 环境限制与正式发布约束

当前容器无法连接 GitHub clone endpoint，因此无法创建本地 checkout，也无法替用户检查其电脑工作区的 `git status --short --branch` / 未提交修改。本节点因此使用精确正式 SHA、隔离候选 branch、GitHub clean Actions、Frozen DocumentModel hash、diff audit 和发布前正式 HEAD 防漂移核对作为替代验证；该限制没有伪装为已完成的本地工作区检查。

本文档与根 README 写入后，新的最终文档 HEAD 必须再次执行 Stage 0–5 + Windows 全链。只有该同一 tree 全部通过，且 `rewrite/stage-05` 仍精确停在 `919aab0233f24262eeaffff1aa7ab0d19b9839ba`，才允许把最终 tree 压成一个以该 SHA 为唯一父提交的 Atomic 5.10 正式提交，并以 `force=false` fast-forward。Atomic 5.11 在正式闭环前保持未开始。
