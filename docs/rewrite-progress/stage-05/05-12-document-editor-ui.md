# Stage 5 / Atomic Task 5.12：文档与编辑器 UI

## 状态

- 结果：**PASS（实现候选已完成 Stage 0–5 + Windows 全链验证；本文档所在最终 tree 仍须再次验证后才允许正式发布）**。
- 正式父基线：`66f0332f101fe6dcea3457bbc3394af24bc2c629`（Atomic 5.11 正式 HEAD）。
- clean 实现候选：`190cc06061ae072bffd7a877deafd799ed1a8bb3`。
- Stage 5 实现候选验证：GitHub Actions run `31453784118` — **SUCCESS**。
- Evidence：`stage-05-document-editor-ui-31453784118-1`。
- Evidence ID：`9087290744`。
- Evidence digest：`sha256:02051ddf1214a61dc42fa636ba25ecd53f32a9da2ac2cd0db4bc1ff5d66a44ce`。
- Atomic 5.13：**未开始**。

## 任务书边界

本节点严格对应 `agent/plan/markdown-main-full-rewrite-taskbook-18-docs/06-阶段05-文档会话与编辑器基础.md` 的 Atomic 5.12：文档与编辑器 UI。

任务书要求：

- 文档列表、文档标题、编辑器工具栏和对话框只发送命令并订阅只读状态；
- 5.12 所有权范围内不得保留 HTML 内联事件；
- View 只能拥有 DOM 引用、监听器和临时展示状态，不得复制业务状态；
- 跨功能通信必须通过显式命令、只读订阅或端口；
- start/destroy、异常、取消和过时异步结果必须可验证；
- Atomic 5.13 的旧路径彻底删除不得提前混入本节点。

## 原问题与影响链

Atomic 5.12 前，文档与编辑器 UI 仍由 compatibility HTML 和 classic 脚本共同持有：

- `public/app/core.js` 通过字符串 `innerHTML` 构建文档列表，并在生成的 HTML 中写入 `onclick/oncontextmenu`；
- 文档标题输入由 `public/app/events.js` 直接监听并写 Document Controller；
- `public/app/editor-tools.js` 同时承担工具栏事件、颜色菜单、链接/图片/表格/数学/Mermaid 对话框 DOM 与业务后置工作流；
- `public/app/web-clipper.js` 仍持有 Find/Replace 对话框展示、状态文本和选择同步；
- `public/compatibility/business-content.html` 在上述文档/编辑器 surface 上仍通过 inline handler 绑定 classic 函数；
- UI 状态、业务命令和 ModalShell 生命周期因此跨 `core.js`、`editor-tools.js`、`web-clipper.js`、`events.js` 和 compatibility HTML 分散。

5.13 仍需删除剩余 classic 路径，所以本节点不能通过复制 classic 实现或增加新的 `window.*` API 暂时绕过迁移。

## 最终职责边界

### Documents UI

新增：

- `src/features/documents/ui/document-list-view.js`
- `src/features/documents/ui/document-list-item-view.js`
- `src/features/documents/ui/document-context-menu-view.js`
- `src/features/documents/ui/document-title-view.js`

职责：

- `DocumentListView` 只订阅只读 Session snapshot，并拥有已渲染 item View 的生命周期；
- `DocumentListItemView` 使用 DOM primitive 构建单条记录，把 open/close/context gesture 转成注入 intent；
- `DocumentContextMenuView` 只拥有菜单显示位置/目标文档等临时展示状态，具体操作通过命令边界发送；
- `DocumentTitleView` 只反映 active record 的标题并发送 title draft 命令，不拥有标题权威状态。

新增 scoped `classic-document-ui-command-port.js` 仅登记仍由 classic application workflow 暂时实现的回调。它不拥有 Session、正文或 DOM，生命周期沿用既有 `remove-with-classic-document-callers` 分类，必须在 5.13 随 classic caller 一起退出。

### Editor application / commands

新增：

- `editor-selection-service.js`
- `editor-focus-service.js`
- `link-command.js`
- `image-command.js`
- `table-command.js`
- `math-command.js`
- `mermaid-command.js`

并扩展现有 `EditorCommandService` / `inline-format-commands.js`，使 View 只通过中性 Editor command/selection/focus contract 工作。命令模块不负责 Toast、保存、预览或 Modal 生命周期。

新增 scoped `classic-editor-ui-command-port.js` 只登记 5.13 前仍由 classic workflow 完成的布局/后置 UI callback，不建立新的全局业务 API，生命周期沿用既有 `remove-with-classic-editor-callers` 分类。

### Editor Views

新增：

- `editor-pane-view.js`
- `editor-toolbar-view.js`
- `inline-color-menu-view.js`
- `find-replace-dialog-view.js`
- `link-dialog-view.js`
- `image-dialog-view.js`
- `table-dialog-view.js`
- `math-dialog-view.js`
- `mermaid-dialog-view.js`

职责：

- 只拥有 DOM refs、监听器、打开/关闭状态及表单临时值；
- 工具栏通过 `data-*` action + EventScope 派发命令，不直接写正文；
- inline color View 只保存当前 UI selection snapshot，实际文本变换由 command service 提交；
- Find/Replace View 继续使用 5.11 command cursor/request generation，不复制搜索状态；
- link/image/table/math/mermaid View 只收集表单输入并发送对应 command；
- 对话框继续通过 Stage 2 ModalShell event port 获取唯一 modal lifecycle，不恢复直接 `classList/style.display` 生命周期所有权；
- `destroy()` 均幂等并释放监听器/临时状态。

### Composition

`src/main.js` 仅负责实例化上述 service/View、把现有 classic application workflow 以显式 callback 注册到 scoped command port，并按反向顺序销毁资源。5.12 不把 View 业务重新堆回 composition root。

## HTML / classic caller 收口

`public/compatibility/business-content.html` 对 5.12 已接管的文档/编辑器 surface 改为 declarative `data-*` hooks；对应 inline handlers 被删除。

classic 文件只保留 5.13 尚需迁移的 application workflow：

- `core.js` 不再字符串拼接文档列表；
- `events.js` 不再直接拥有标题/5.12 编辑器 View listener；
- `editor-tools.js` 不再拥有已迁移的编辑器对话框和 toolbar DOM 生命周期；
- `web-clipper.js` 不再拥有 Find/Replace modal presentation；
- `export.js` / `web-clipper.js` 继续拥有不属于 5.12 的剩余 compatibility modal caller；
- 未恢复任何新 `window.*` UI 业务入口。

整个应用仍存在其他后续阶段/legacy surface 的 inline event baseline；5.12 的硬门禁只允许它们留在明确未迁移所有权中，并要求本节点接管的 document/editor UI surface 为零 inline event。Atomic 5.13 仍需继续清除 Stage 5 classic 路径。

## 永久验证

新增：

- `tests/unit/documents/document-ui.test.mjs`
- `tests/unit/editor/editor-ui-foundation.test.mjs`
- `tests/architecture/stage-05-document-editor-ui-boundary.test.mjs`

并将 Atomic 5.12 独立 gate 接入 `.github/workflows/stage-05-atomic.yml`。

永久门禁覆盖：

- Documents Views 的只读 Session 订阅、命令派发、无正文状态和 teardown；
- Editor toolbar/dialog Views 的命令边界和事件清理；
- Selection / Focus service 的中性 adapter 边界；
- 5.12-owned HTML surface 无 inline handler；
- classic 文件不再持有已迁移 View DOM 生命周期；
- public feature entry 不被外部越过内部路径；
- Frozen `DocumentModel` 精确 hash 保持不变；
- 生产 module inventory 精确覆盖当前 292 个模块。

## 实施期间失败与处理

### 红灯基线

5.12 新 architecture contract 在 5.11 正式树上按预期失败：目标 `documents/ui` / `editor/ui` 文件尚不存在，且 compatibility document/editor surface 仍含 inline handler。该失败用于证明 5.12 迁移目标真实存在，没有删除或弱化测试。

### 首版 candidate 的 module inventory 分类失败

首版实现候选 `6db01f06fe9bba0aeb2ca1651ef2eb65e56928f4` 上，Stage 0/3/4/5/Windows 已通过，但 Stage 1/2 被 module inventory 硬门禁拦截。原因是两个新 scoped UI command port 使用了未登记的新 migration 字符串：

- `remove-with-classic-document-ui-callers`
- `remove-with-classic-editor-ui-callers`

没有扩展白名单。两个 port 被分别重新归入现有、语义正确的 `remove-with-classic-document-callers` 与 `remove-with-classic-editor-callers`，随后 Stage 1 inventory 恢复通过。

### Stage 2 ModalShell caller 漂移

inventory 修正后的 candidate 在 Stage 2 Atomic 2.6 被旧测试拦截。compatibility modal registry 的“剩余七个 modal”契约本身已通过；失败只因测试仍要求 `public/app/editor-tools.js` 必须发送 modal-shell open/close event。

5.12 后实际 caller 已变为：

- `public/app/export.js`
- `public/app/web-clipper.js`
- `link-dialog-view.js`
- `find-replace-dialog-view.js`
- `image-dialog-view.js`
- `mermaid-dialog-view.js`

测试改为检查这些真实 owner 仍通过 `markdown-editor:modal-shell-open/close` 使用唯一 ModalShell bridge，并继续禁止新 global/重复 modal lifecycle。未把已迁移 View 恢复到 `editor-tools.js`，也未削弱 ModalShell 断言。

## 实现候选全链验证

clean 实现候选 `190cc06061ae072bffd7a877deafd799ed1a8bb3`：

- Stage 0 Baseline Verification `31453784158` — **SUCCESS**；Node、Browser Contract、frontend build、Built App、`cargo test --locked`、`cargo check --locked`、extended Tauri Linux build、evidence 和最终 hard gate 全部通过。
- Stage 1 Atomic Verification `31453784115` — **SUCCESS**。
- Stage 2 Atomic Verification `31453784127` — **SUCCESS**，包含更新后的 ModalShell ownership contract。
- Stage 3 Atomic Verification `31453784141` — **SUCCESS**。
- Stage 4 Atomic Verification `31453784114` — **SUCCESS**。
- Stage 5 Atomic Verification `31453784118` — **SUCCESS**；5.1–5.12、CR-05、Frozen DocumentModel、Architecture、Node、Browser Contract、Build、Built App 与 5.12 evidence 全部通过。
- Windows Native `31453784125` — **SUCCESS**；release application、isolated WebDriver host、输入验证和真实窗口自动化全部通过。

上述最终 clean implementation candidate 的七组验证均无需环境重跑。

## 影响与保持不变

未修改：

- Frozen `DocumentModel` 算法、版本、事务、偏移量和 hash；
- Rust/Tauri 源码；
- package dependencies / lockfile；
- 持久化格式与迁移语义；
- 平台权限、安全策略和公共错误语义；
- 用户现有文档生命周期、快捷键和编辑器可观察行为。

5.12 改变的是 UI 责任所有权和内部调用边界，不改变对应用户功能语义。

## 下一步

Atomic 5.13 尚未开始。5.13 必须在 5.12 正式发布并再次完成最终 tree 验证后，继续删除 `core/editor-tools` 已迁移逻辑、隐藏 textarea compatibility 和本阶段 scoped classic command ports；不得保留 wrapper 作为第二实现。