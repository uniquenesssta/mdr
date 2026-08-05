# Stage 2 / Atomic Task 2.4：App Shell

## 状态

- 当前状态：实现完成，正式三层复验待执行。
- 实施分支：`rewrite/modular-rebuild`。
- 实施起点：`523b596c090464c5ded4353c4c725514a029f159`。
- 实施工作流：待正式 GitHub CI 生成。
- Atomic Task 2.5 尚未开始。

## 实施内容

- 新增 `src/ui/create-ui.js`，提供 `createUI(root)`，严格返回 `menu/toolbar/sidebar/editor/preview/status/overlay` 七个命名引用和幂等 `destroy()`。
- 新增 `src/ui/shell/` 下 7 个职责模块：App Shell 组合、顶部菜单、工具栏、侧栏、工作区、状态栏和 overlay root。
- App Shell 只创建 DOM 结构、稳定 ID/class、ARIA 区域和临时 DOM 引用；不读取业务 store，不绑定事件，不访问模型、平台或持久化。
- 工作区由单一模块拥有侧栏分隔条、编辑槽、编辑/预览分隔条和预览槽；现有 `#sidebar`、`#sidebar-resizer`、`#editor`、`#resizer`、`#preview` 调用链保持可用。
- `public/compatibility/current-shell.html` 从旧 `.app` 壳改为 8 个显式模板：`menu/toolbar/sidebar/editor/preview/status/overlay/ports`。模板只保留尚未迁移的业务内容，不再定义 App Shell 包装结构。
- `mount-current-shell.js` 只负责校验模板、调用 `createUI`、将内容挂入严格 refs、恢复主题并在销毁时完整恢复 `#app-root`。
- 上下文菜单、模态框、拖放遮罩、toast 和离屏导出节点暂时保留在兼容 overlay 模板；其行为分别仍归 2.5、2.6 和后续 feature 迁移，不在本节点重写。
- 更新机器可读生产模块清单，当前记录由 71 增至 79；Stage 1 历史交接中的 67 个模块事实保持不变。
- 永久 Stage 2 CI 新增 2.4 专项契约和结构化证据。

## 兼容性

- 保留 184 个既有内联事件、35 个图标 ID、50 个兼容壳图标引用以及全部业务 DOM ID。
- 保留旧经典脚本、`src/main.js`、i18n、编辑器、预览、文件端口和 overlay 功能调用顺序。
- 生产运行时只有新 App Shell 一套壳结构；兼容文件只提供业务内容模板。
- 未修改 CSS 视觉规则、Rust、依赖、锁文件、配置、冻结模型、持久化结构、错误码或安全策略。

## 验证

已完成的依赖无关本地验证：

- `node --test tests/ui/app-shell.test.mjs tests/ui/minimal-index.test.mjs tests/svg-sprite.test.mjs tests/ui/dom-asset-inventory.test.mjs`：12/12 通过。
- `node --test tests/architecture/module-inventory.test.mjs`：3/3 通过。
- 新增生产模块与浏览器测试 `node --check`：通过。
- 旧兼容壳与新壳/模板等价性检查：138 个旧业务 ID、139 个旧 class 均无遗漏；仅新增 `#overlay-root/.overlay-root`。
- 184 个内联事件、50 个兼容图标引用和 35 个 Sprite ID 保持不变。
- `npm run verify:no-legacy-runtime`、`npm run verify:generated-files`、`npm run verify:readme-record`：通过。
- `git diff --check`：通过。

未完成的正式验证：

- 本地 `npm ci --ignore-scripts` 被当前容器内部 npm 镜像缺少 `w3c-keyname@2.2.8` 阻塞；没有修改依赖或锁文件。
- `npm test`、完整架构门禁、浏览器契约、生产构建、构建后完整应用回归、Rust 和 Tauri 链路将由 GitHub CI 执行。

浏览器完整应用回归契约已新增：要求只存在一个 `[data-ui-shell="app"]`，七个严格插槽各一个，旧业务 ID 无重复，设置模态框位于 `#overlay-root`，隐藏文件端口仍位于 `#app-root`，并继续执行现有布局和编辑/预览交互回归。

## 已知限制

- 本节点未实现 2.5 DOM 原语、2.6 Modal Shell 或 2.7 之后的 CSS 迁移。
- Ubuntu 22.04 Chromium/Tauri 验证不替代 Windows 原生 WebView、窗口控制、文件关联和系统拖放的真实平台回归。
- 既有 2 个 npm audit advisory 不属于本节点，未修改依赖或锁文件。
