# Atomic 6.14 — 销毁验证

## 任务边界

本 Atomic 只验证并修复 Stage 6 生命周期资源清理，不新增业务功能，不改变 Layout / Sidebar / Menu / Window 的公共行为，也不进入 Stage 7。

任务书要求：

- 所有 pointer / window / observer / timer / subscription 清理计数归零；
- 重复 `start()` / `destroy()` 不增加监听器；
- 发现真实资源泄漏时只修对应生命周期路径。

## 审计范围

本轮对 Stage 6 资源所有者逐项检查创建点、销毁点、重复启动以及 stale callback 路径。

### Layout

- `SidebarResizeController`：pointer listeners、pointer capture、viewport resize。
- `SidebarLayoutController`：LayoutState subscription。
- `SplitResizeController`：pointer listeners、pointer capture、LayoutState subscription、RAF。
- `SplitPaneController`：collapse listener。
- `CompactSplitController`：pane listeners、ResizeObserver / resize fallback、RAF。
- `CompactShellController`：viewport resize、RAF、settle timer。
- `ToolbarBoundaryController`：ResizeObserver / resize fallback、RAF。
- `SystemFullscreenController`：platform fullscreen subscription。

### Sidebar

- `SidebarTabController`：3 个 tab click listener + SidebarState subscription。
- `OutlineView`：list click、panel contextmenu、context-menu click。
- `FolderTreeView`：refresh click、panel keydown。
- `FolderTreeNodeView`：目录/文件节点本地 click listener，包含递归 child view 销毁。

### Menu

- `MenuView`：root capture click listener。
- `MenuController`：MenuState subscription。
- `SubmenuPositioner`：pointer/focus listeners、close timer、RAF。
- `RecentFilesMenuController`：delegated click + Documents read subscription。

### Window

- `WindowControlsView`：WindowState subscription + 3 个 control click listener。
- `WindowDragRegion`：mousedown listener。
- `WindowCloseController`：native close subscription。
- `WindowController`：resize subscription。

组合根继续由 `src/main.js` 与 `src/bootstrap/module-entry.js` 按既有职责销毁上述资源所有者。

## 确认并修复的真实问题

新增红测后确认 `CompactSplitController` 存在一条 stale async 路径：

1. `ResizeObserver` 已经捕获 `scheduleEvaluation` callback；
2. controller 执行 `destroy()`，已取消当前 RAF 并 disconnect observer；
3. 浏览器/observer 队列中的旧 callback 仍可能晚到；
4. 旧实现会再次调用 `requestFrame()`，使 destroy 后资源计数从 0 回升到 1。

修复仅位于 `src/features/layout/split/compact-split-controller.js`：`scheduleEvaluation()` 在 `destroyed` 状态直接返回，不再创建新 RAF；活动状态下的 compact split 阈值、pane 切换、observer 与 resize fallback 行为保持不变。

对应红测：

`Atomic 6.14 CompactSplit stale ResizeObserver callback cannot allocate work after destroy`

- 修复前 run `31605350255`：FAIL，确认 stale callback 会创建 post-destroy RAF；
- 修复后 run `31605415930`：PASS。

## 生命周期资源账本

新增测试辅助模块：

`tests/helpers/lifecycle-resource-ledger.mjs`

只用于测试，按类别精确统计活动资源：

- listeners
- pointerCaptures
- observers
- frames
- timers
- subscriptions
- total

它提供受控 EventTarget、pointer target、ResizeObserver、RAF、timer 与 subscription source，使 destroy 后的资源数量可重复计算，而不是只靠静态检查 `removeEventListener()` 是否存在。

按职责拆分验证文件：

- `tests/unit/layout/stage-06-layout-destroy-validation.test.mjs`
- `tests/unit/sidebar/stage-06-sidebar-destroy-validation.test.mjs`
- `tests/unit/menu/stage-06-menu-destroy-validation.test.mjs`
- `tests/unit/window/stage-06-window-destroy-validation.test.mjs`

没有把全 Stage 6 的生命周期验证堆进单一大测试文件。

## 验证语义

每个适用 controller/view 都验证：

1. 第一次 `start()` 建立预期资源；
2. 第二次 `start()` 不增加 listener / observer / subscription / timer / RAF；
3. 有 pointer capture、queued RAF 或 timer 的路径会先真实进入活动状态；
4. `destroy()` 后所有受控资源计数归零；
5. 第二次 `destroy()` 仍保持归零；
6. Compact Split 额外验证 destroy 后 stale observer callback 不能恢复 RAF；
7. Window async controller 额外验证重复 `start()` / `destroy()` 复用同一生命周期 transition。

跨域资源账本最终为 17/17 PASS。

## 架构门禁

新增：

`tests/architecture/stage-06-destroy-validation.test.mjs`

固定以下事实：

- 生命周期资源账本与四个域级测试文件必须存在；
- 六类资源必须被计数；
- 20 个已审计 Stage 6 资源所有者继续保留明确 destroy 边界；
- Compact Split 必须保留 post-destroy scheduling guard、observer disconnect 与 RAF cancel；
- `src/main.js` 继续销毁 Layout / Sidebar / Recent Files Menu / Window 资源所有者；
- `src/bootstrap/module-entry.js` 继续销毁 Menu controller / submenu positioner / bindings / state。

`tests/architecture/stage-06-window-controller.test.mjs` 中 6.13 的历史“6.14 尚不存在”断言已演进为“6.14 验证存在但 Window 生命周期所有权仍留在 Window feature”断言，没有削弱 6.13 的职责边界。

## 候选验证

candidate workflow run `31606853046` 使用与正式 `stage-06-atomic.yml` 相同的完整链路，结果全 PASS：

- dependency prepare / audit：PASS
- Stage 4 handoff：PASS
- Atomic 5.1–5.13 + CR-05：PASS
- Atomic 6.1–6.13：PASS
- Atomic 6.11 / 6.12 / 6.13 real Chromium：PASS
- Atomic 6.14 resource-ledger + architecture：PASS
- modified-module parse：PASS
- Frozen DocumentModel exact hash：PASS
- Architecture hard gate：PASS
- full Node regression：PASS
- browser interaction contract：PASS
- build：PASS
- built application regression：PASS
- evidence upload：PASS

最终清理临时 candidate 触发/workflow 后还需对干净候选树再次隔离验证，并以正式 `rewrite/stage-06` workflow 作为最终交付验收事实。

## 兼容性与限制

- 未修改 Frozen DocumentModel。
- 未修改公共接口、持久化格式、迁移语义、Rust API、配置、环境变量、安全策略或生产依赖。
- 唯一生产代码变化是 Compact Split 生命周期 guard，不改变正常运行时布局行为。
- 当前执行环境没有可用本地 Git worktree，因此无法执行本地 `git status`；远端不可变 SHA、精确 diff 与 GitHub Actions 作为本轮工作区与验证事实来源。
- Stage 7 未开始。
