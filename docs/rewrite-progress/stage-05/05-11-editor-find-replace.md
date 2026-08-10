# Stage 5 / Atomic Task 5.11：Find/Replace

## 状态

- 结果：**PASS（实现候选已完成 Stage 0–5 + Windows 全链验证；本文档所在最终 tree 仍须再次验证后才允许正式发布）**。
- 正式父基线：`a905dd66ab704856c2e85465ba5869458492e7bb`（Atomic 5.10 正式 HEAD）。
- clean 实现候选：`59292618dbd59b17f188c399813d0cf54e1a84ce`。
- Stage 5 实现候选验证：GitHub Actions run `31408970856` — **SUCCESS**。
- Evidence：`stage-05-editor-find-replace-31408970856-1`。
- Evidence ID：`9070801089`。
- Evidence digest：`sha256:ff0147f1866c869ab696d2fb4362d9d8df76bba66b91f1b1bc32fba2f0c81d52`。
- Atomic 5.12：**未开始**。

## 任务书边界

本节点严格对应 `agent/plan/markdown-main-full-rewrite-taskbook-18-docs/06-阶段05-文档会话与编辑器基础.md` 的 Atomic 5.11：Find/Replace。

任务书要求：

- 搜索按局部读取执行；
- 替换通过单事务提交；
- 为 native 大文档搜索预留显式端口；
- 禁止隐式全文复制；
- 异步结果必须能够拒绝过时结果；
- Find/Replace 对话框 UI 属于 Atomic 5.12，本节点不得提前重写。

## 原问题与影响链

Atomic 5.11 前，Find/Replace 业务意外寄生在 `public/app/web-clipper.js`：

- classic 脚本直接持有 `findIndex` 搜索游标；
- native 大文档搜索直接调用 `window.markdownEditorDocumentStore.search()`；
- 本地搜索直接调用冻结 `DocumentModel.findText()` 或 virtual-editor fallback；
- 最后兼容 fallback 会读取 `el.value` 并使用 `indexOf()`；
- Replace All 最后 fallback 会复制全文并使用 `split().join()`；
- classic UI 同时负责 modal、状态文本、selection/focus、preview/count/autosave。

快捷键 `Ctrl/Cmd+F`、`Ctrl/Cmd+H` 仍由 classic `events.js` 打开现有 modal。为了不提前进入 5.12，本节点保留 modal、快捷键和 UI wrapper，只迁移搜索/替换业务权威。

## 最终职责边界

### `src/features/editor/commands/find-replace-command.js`

新增责任单一的 Find/Replace command：

- 只依赖注入的 neutral Editor Adapter 与可选的 per-call native-search callback；
- 不导入 DOM、window、localStorage、DocumentModel、native store、raw CodeMirror、preview/save/toast/history；
- local Find 只通过 adapter `findText(query, from, { wrap })`；该 adapter 使用有界 chunk 搜索，不需要 command 层复制全文；
- Replace One 只读取当前 selection 范围，并在匹配时提交一次 `replaceRange()`；
- Replace All 只调用一次 adapter `replaceAllText()` 高层批量事务；
- 唯一拥有 `cursor`、`requestGeneration` 与终态 lifecycle；不拥有正文副本、match 列表或 UI 状态；
- native search 请求带 `requestId`；后发操作会使先发异步结果失效；过时或 destroy 后完成的结果返回 `undefined`，不得推进 cursor；
- `destroy()` 幂等、终态，并使所有在途搜索失效；不销毁注入 adapter。

### `EditorCommandService`

`src/features/editor/application/editor-command-service.js` 继续作为唯一 Editor command 应用层入口：

- 5.10 basic formatting 与 5.11 Find/Replace 组合在同一 Service；
- 新增 `findNext / replaceOne / replaceAll`；
- adapter 契约增加 `findText / replaceAllText`；
- Service 不复制正文，不接管 Find cursor；cursor/request state 只属于 Find/Replace command；
- Service destroy 负责终止其拥有的 Find/Replace command lifecycle。

### classic compatibility port

`src/features/editor/compatibility/classic-editor-command-port.js` 沿用已有单一 scoped host property `markdownEditorEditorCommandPort`，新增转发：

- `findNext`；
- `replaceOne`；
- `replaceAll`。

没有为 5.11 新建第二个 compatibility port，也没有复制 Find cursor 或正文状态。

### classic UI wrapper

`public/app/web-clipper.js` 现在：

- 不再持有 `findIndex`；
- 不再直接调用 `DocumentModel.findText/replaceAllText`；
- 不再直接调用 virtual-editor Find/Replace；
- 不再通过 `el.value + indexOf` 或 `split/join` 做全文 fallback；
- `findNext / replaceOne / replaceAll` 只调用 scoped Editor Command port；
- native 大文档搜索资格判断、保存当前 native 文档后再搜索的原有语义仍保留在 UI/application wrapper，并以显式 `nativeSearch` 回调注入 command；
- native search 抛错时记录 warning 后由 command 使用有界 local adapter fallback；native search 成功返回 `null` 时保持“确实无匹配”，不会重复本地扫描；
- stale async result 使用 `undefined` 表示，`applyFindMatch()` 对该值直接无操作，不更新 selection/status；
- modal、状态文本、focus/scroll、preview selection sync、replace 后 preview/count/autosave 保持原有 wrapper 责任，等待 5.12 再迁移 UI。

## 单事务与全文复制约束

现有 CodeMirror Adapter 已提供满足 5.11 的 neutral operation：

- `findText()`：使用 64 KiB 级有界 chunk + overlap 搜索；
- `sliceText()`：按明确范围读取；
- `replaceRange()`：单次局部 transaction；
- `replaceAllText()`：先构建 changes，再进行一次 CodeMirror `dispatch`。

因此 5.11 没有修改 CodeMirror Adapter，也没有修改冻结 DocumentModel。command 层禁止 `.value` 和 `.getText()` 全文读取；classic 层只保留打开 Find modal 时对当前 selection 的有界预填读取。

## 模块、兼容性与冻结边界

production module ownership fixture 从 **269 → 270**，只新增一个真实职责模块：

- `src/features/editor/commands/find-replace-command.js`。

Stage 1 历史“67 个生产模块”记录保持不变；仅当前 inventory 断言同步到 270。

冻结 `src/document/document-model.js` blob/hash 始终保持：

`d767d9025be05a6f6b87d7cd3527782db1c3303a`

未新增生产依赖；未修改 lockfile、Rust/Tauri、持久化格式、Settings、安全策略、权限、Find modal DOM、快捷键或用户可见 Find/Replace 入口。

## 测试与永久门禁

新增：

- `tests/unit/editor/find-replace-command.test.mjs`：覆盖 local find/wrap、native 成功、native 失败 fallback、requestId、后发操作淘汰先发 native 结果、bounded Replace One、单次 Replace All、pending search invalidation、空 query、destroy 终态与在途结果淘汰；
- `tests/architecture/stage-05-find-replace-boundary.test.mjs`：锁定计划路径、neutral adapter 边界、native port/request generation、禁止隐式全文读取、禁止 command 依赖 UI/平台/模型、classic cursor/full-text fallback 删除以及 5.12 modal wrapper 保留；
- `.github/workflows/stage-05-atomic.yml`：增加独立 `Verify Atomic Task 5.11 Find Replace` 门禁，同时继续保留 5.1–5.10、CR-05、Frozen DocumentModel、Architecture、Node、Browser、Build 和 Built App 全部验证；最终权限仍为 `contents: read`。

候选生成期间使用的 `.github/workflows/atomic511-audit.yml`、`atomic511-materialize.mjs`、`atomic511-inventory-finalize.mjs` 均已在 clean candidate 前删除，未进入正式候选 diff。

## 失败先证与实施记录

### 只读审计

run `31405612131`：**SUCCESS**。确认 5.10 基线通过，并定位 Find/Replace 实际位于 `public/app/web-clipper.js`，包含 `findIndex`、direct model/virtual search、native search 和全文 fallback。

### 旧实现红灯

run `31406215460`：5.10 baseline **PASS**；新增 5.11 gate 因 `src/features/editor/commands/find-replace-command.js` 尚不存在而按预期 **FAIL**，后续门禁 hard-stop。该 run 不计为通过。

### 首轮 focused 实施

run `31406986980`：**SUCCESS**。5.10 baseline、初版 5.11、Frozen DocumentModel、Architecture、Node、diff cleanliness 均通过。

之后按任务书的异步过时结果要求复核，发现 native search 首版缺少 generation guard，因此在进入全链前主动补充 request generation、requestId、stale completion 与 destroy invalidation 测试/实现。

run `31407481642`：**SUCCESS**。包含上述异步竞态测试后，5.10/5.11/Frozen/Architecture/Node/diff 全部通过。

### 模块头文本触发现有 5.10 门禁

run `31407787116`：**FAIL**。失败发生在 5.10 architecture gate；新增的 `EditorCommandService` 模块头注释中出现单词 `persistence`，命中了 5.10 已存在的 `/preview|toast|persist|storage|autosave/i` 文本禁入规则。运行代码没有引入该依赖，但该 run 仍按硬失败处理；没有删除或放宽测试。

修正方式仅为把模块头改成“只允许 responsibility-specific Editor command modules 与 injected neutral adapter contract”，保持职责说明准确并继续满足原 5.10 gate。

run `31407929617`：**SUCCESS**。5.10 baseline、5.11、Frozen DocumentModel、Architecture、全量 Node、diff cleanliness 全部通过。

## clean 实现候选全链验证

clean candidate `59292618dbd59b17f188c399813d0cf54e1a84ce` 已通过：

- Stage 0 Baseline Verification `31408970999`：**SUCCESS**，含 Node、Browser Contract、Build、Built App、Rust tests/check、extended Tauri Linux build、evidence 与 hard gate；
- Stage 1 Atomic Verification `31408970416`：**SUCCESS**；
- Stage 2 Atomic Verification `31408970207`：**SUCCESS**；
- Stage 3 Atomic Verification `31408970151`：**SUCCESS**；
- Stage 4 Atomic Verification `31408970704`：**SUCCESS**；
- Stage 5 Atomic Verification `31408970856`：**SUCCESS**，5.1–5.11、CR-05、Frozen DocumentModel、Architecture、Node、Browser Contract、Build、Built App 与 5.11 evidence 全部通过；
- Stage 3 Windows Window Automation `31408970634`：**SUCCESS**，真实 Windows 原生窗口自动化通过。

本轮 clean implementation candidate 的七组验证均直接成功，没有使用失败 job 重跑。

## 工作区与发布约束

实施前已确认用户新建的独立 Stage 5 worktree：

- 分支：`rewrite/stage-05`；
- `git status --short --branch` 无修改；
- HEAD：`a905dd66ab704856c2e85465ba5869458492e7bb`。

原 Stage 4 worktree 中已有大量用户修改，因此保持完全不动，没有执行 reset、clean、stash 或强制 checkout。

当前执行容器仍无法通过 GitHub clone endpoint 建立本地 checkout，因此实际实施与 CI 使用精确正式 SHA、隔离 candidate branch、GitHub clean runner、Frozen Model hash、diff audit 与发布前正式 HEAD 防漂移核对。该限制没有被描述为本地验证已执行。

本文档和根 README 写入后，新的最终文档 HEAD 必须再次执行 Stage 0–5 + Windows 全链。只有同一最终 tree 全部通过，且正式 `rewrite/stage-05` 仍精确停在 `a905dd66ab704856c2e85465ba5869458492e7bb`，才允许把该 tree 压成一个以该 SHA 为唯一父提交的 Atomic 5.11 正式提交，并以 `force=false` fast-forward。