# Atomic 6.13 — Window Controller

## 任务边界

本 Atomic 只重写桌面窗口控制职责：窗口状态、窗口控件、拖动区域、resize / native-close 订阅与关闭编排。关闭前保存必须通过显式 `CloseSavePort` 委托给应用层；未进入 Atomic 6.14 Destroy Validation。

## 实际实现

- 新增 `src/features/window/window-state.js`：
  - 唯一拥有 `available` / `maximized` / `closePhase` / revision；
  - 发布不可变快照；
  - no-op 抑制、订阅与 terminal destroy 明确。
- 新增 `src/features/window/window-controls-view.js`：
  - 唯一拥有最小化/最大化/关闭按钮 click listener；
  - 从 `WindowState` 投影 `tauri-shell`、`window-maximized`、按钮 title / aria-label / icon；
  - 不调用平台层、不持有窗口状态。
- 新增 `src/features/window/window-drag-region.js`：
  - 唯一拥有菜单栏 `mousedown` 拖动手势；
  - 保留左键拖动、交互元素排除、双击最大化语义；
  - unsupported 环境不绑定手势 listener。
- 新增 `src/features/window/window-close-controller.js`：
  - 唯一拥有 native close-request subscription；
  - native close 在保存完成前 `preventDefault()`；
  - 关闭统一先 `CloseSavePort.prepareClose()`；
  - `requestClose()` 失败继续按既有行为回退 `forceClose()`；
  - 双失败保留通知、telemetry 与错误证据；
  - 并发关闭、stale async、destroy generation 均显式处理。
- 新增 `src/features/window/window-controller.js`：
  - 组合 state / controls / drag / close；
  - 唯一拥有 resize subscription 与 maximize state refresh；
  - `stateRequestGeneration` / `lifecycleGeneration` 阻止旧异步结果覆盖新状态；
  - cleanup 顺序和错误聚合明确。
- 新增 `src/features/window/close-save-port.js`：
  - 应用层显式关闭保存契约；
  - 只允许注册一个返回 Boolean 的 close-save policy；
  - 不拥有 Documents 或 Window 内部状态。
- 新增 `src/features/window/compatibility/classic-close-save-port.js`：
  - classic 侧只暴露 `register(handler)`；
  - 不暴露 `prepareClose`、窗口方法或第二份状态。
- 新增 `src/features/window/index.js` 作为唯一 Window public entry，只负责导出，不承载实现。

## 生产切换

`public/app/events.js` 中原有窗口权威已物理删除：

- `applyWindowMaximizedState`
- `refreshWindowChromeState`
- `setupWindowChrome`
- `windowCloseCommitted`
- `windowCloseSaving`
- `commitWindowClose`
- 所有 `eventsPlatformPort.call('window', ...)`
- 启动期 `setupWindowChrome()`

`events.js` 现在只注册既有的应用关闭保存策略：

```text
classic application save / confirm policy
          │ register
          ▼
      CloseSavePort
          │ prepareClose
          ▼
 WindowCloseController
          │ requestClose / forceClose
          ▼
      WindowPort
          │
          ▼
Stage 3 Tauri WindowClient
```

保存失败时仍使用既有 `saveCurrentDocumentState(false, { waitForNative: true, forceSnapshot: true })`、`close-save` 错误记录与“关闭前保存失败”确认语义。Window feature 本身不读取 Documents、storage 或保存实现。

`src/main.js` 只从 `src/features/window/index.js` 组合 Window feature，并直接注入 `platform.window`。Stage 3 `src/platform/desktop/window-client.js` 未修改，仍是 `@tauri-apps/api/window` 的唯一生产 owner。

## 保持不变的用户可观察行为

- 非桌面窗口环境继续隐藏 native window controls。
- 桌面环境继续展示 `tauri-shell` chrome。
- 最小化、最大化/还原、窗口拖动与双击最大化语义保持不变。
- 最大化状态继续跟随 resize/native state 刷新。
- maximize/restore 继续引用统一 `/assets/icons.svg` sprite。
- native 关闭和关闭按钮都必须先执行关闭前保存策略。
- 保存失败继续允许用户“返回编辑”或确认“仍然关闭”。
- 正常 close 失败继续回退 force close；两条 native close 路径均失败时继续显示错误，不静默吞掉。

## 生命周期与异常路径

- `WindowState` 是唯一窗口状态 owner；View/Drag/Close/Controller 不复制状态中心。
- resize 与 native-close subscription disposer 都由各自 lifecycle owner 持有。
- 如果 subscription 在 destroy 后才返回 disposer，会立即释放；该 late disposer 自身失败时错误继续传播到 destroy，不被静默吞掉。
- stale maximize 查询不能覆盖较新的 state transition。
- CloseSave pending 时重复关闭返回 busy，不启动第二条保存/关闭链。
- destroy 后 click、drag、resize、close callback 不再产生新的 WindowPort 调用。
- 本 Atomic 只保证自身资源清理正确，未新增 6.14 的全局 listener / observer / timer / subscription 计数验证。

## 验证

candidate run `31602870656` 已对 6.13 实现与正式 Stage 6 workflow 变更执行完整验证并 PASS：

- Window production parse：PASS
- Window unit / historical Stage 3 / architecture / public contract：PASS
- Atomic 6.13 real Chromium controls / drag / resize / native-close / CloseSave / destroy：PASS
- Frozen DocumentModel hash：PASS
- Architecture hard gate：PASS
- full Node regression：PASS
- browser interaction contract：PASS
- build：PASS
- built application regression：PASS
- evidence upload：PASS

full Node 首轮曾发现 `tests/svg-sprite.test.mjs` 仍把 maximize/restore 动态 icon owner 固定为旧 `events.js`；6.13 已合法迁移该职责，因此测试演进为：旧 `events.js` 不得再拥有该动态图标，而 `window-controls-view.js` 必须继续引用同一 external sprite。图标定义、数量与统一 sprite 门禁未弱化。

包含 README 与本进度记录的最终候选还会再次经过完整验证；正式 `rewrite/stage-06` workflow 作为发布后的最终交付验收事实。

## 兼容性与限制

- 未修改 Frozen DocumentModel。
- 未修改 Documents 持久化结构、格式或迁移语义。
- 未修改 Rust API、Tauri WindowClient、权限、安全策略、配置、环境变量或生产依赖。
- 未进入 Atomic 6.14。
- 当前执行环境没有可用本地 Git worktree，因此本地 `git status` 无法执行；远端不可变 SHA、精确 diff 与 GitHub Actions 作为本轮工作区/验证事实来源。
