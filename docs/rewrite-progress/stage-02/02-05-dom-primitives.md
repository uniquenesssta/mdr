# Stage 2 / Atomic Task 2.5：DOM 原语

## 状态

- 当前状态：实现完成，正式三层复验待执行。
- 实施分支：`rewrite/modular-rebuild`。
- 2.4 最终验证基线：`adc068df47f2a9f6198c20458cb1a0c46246787a`。
- 实施前临时快照工作流已删除，远端净起点：`69c48b4971d91a260b12f8386530b788cf795cc8`。
- Atomic Task 2.6 尚未开始。

## 任务边界

本节点只实现以下五类 DOM 基础职责：

1. 安全元素创建。
2. 必需元素引用校验。
3. 事件监听作用域与清理。
4. 初始焦点、Tab 约束、焦点恢复和销毁。
5. 过渡可见性、超时完成和过时隐藏结果取消。

不在本节点实现 Modal Shell、具体模态框字段、提交行为、Escape/遮罩业务策略、CSS 令牌、主题或样式分层。

## 实施内容

### 公共入口与模块职责

新增 `src/ui/dom/index.js`，只显式公开：

- `createSafeElement`
- `requireElementRef`
- `collectRequiredRefs`
- `isElementRef`
- `createEventScope`
- `createFocusScope`
- `createTransitionVisibility`

公共入口不拥有状态和实现逻辑。具体职责拆分为：

- `safe-element.js`：只接受显式 `id/className/text/attributes/dataset`；拒绝可执行标签、`on*`、`srcdoc` 和未声明选项，不提供 `innerHTML` 接口。
- `required-refs.js`：校验元素引用并从明确 selector 契约收集冻结 refs；缺失引用立即以名称和 selector 报错。
- `event-scope.js`：登记监听器、返回幂等单项 disposer、逆序销毁全部监听器、销毁后禁止继续注册，清理异常聚合抛出。
- `focus-scope.js`：拥有初始焦点、可选 Tab 约束、原焦点恢复和幂等销毁；不拥有 Escape 或模态业务语义。
- `transition-visibility.js`：拥有可见 class、`aria-hidden`、`transitionend`/超时完成、重新显示时取消过时隐藏结果和幂等销毁。

### 调用链切换

- `src/ui/create-ui.js` 使用必需引用校验处理 `#app-root`。
- `src/ui/shell/*.js` 全部使用安全元素创建，不再各自重复 document 校验和直接 `createElement()`。
- `src/ui/compatibility/mount-current-shell.js` 使用安全模板元素和必需挂载目标校验；兼容 markup 的受控模板解析仍由该模块单独拥有。
- `src/runtime/link-preview.js` 使用：
  - 安全元素创建构造预览 overlay；
  - 事件作用域登记全局和 overlay 监听器；
  - 焦点作用域实现初始焦点、Tab 约束、关闭恢复；
  - 过渡可见性实现显示/隐藏，并在关闭后立即重开时取消旧隐藏完成结果，防止新 iframe 被旧计时器重置为 `about:blank`。
- 生产调用者只导入 `src/ui/dom/index.js`，不绕过公共入口访问内部原语文件。

## 模块与兼容性

- 机器可读生产模块记录由 79 增至 85。
- 新增 6 个 `ui-dom` 模块，其中 5 个职责模块和 1 个公共 facade。
- 既有 8 个 `ui-shell` 模块职责不变。
- 保留 184 个兼容内联事件、35 个图标 ID、50 个兼容图标引用、App Shell 七个严格 refs 和全部业务 DOM ID。
- 未修改 CSS、Rust、依赖、锁文件、配置、冻结模型、持久化结构、错误码或安全策略。

## 已完成验证

- `node --test tests/ui/dom-primitives.test.mjs`：6/6 通过。
- `node --test tests/ui/app-shell.test.mjs tests/ui/minimal-index.test.mjs tests/svg-sprite.test.mjs`：9/9 通过。
- `node --test tests/architecture/module-inventory.test.mjs`：3/3 通过。
- `node --test tests/browser-e2e-contract.test.mjs`：5/5 通过。
- 新增和修改的生产/测试 JavaScript `node --check`：通过。
- 2.5 浏览器完整应用回归已加入：验证链接预览初始焦点、Tab 环绕、关闭后立即重开不被旧隐藏结果清空，以及最终焦点恢复。

## 待正式验证

- 完整 `npm test`。
- 全量架构硬门禁。
- Chromium 浏览器契约和生产构建后完整应用回归。
- 前端生产构建。
- `cargo test --locked`。
- `cargo check --locked`。
- Tauri Linux release build。
- Stage 2、Stage 1、Stage 0 最终头工件与硬门禁。

本地未安装依赖时，`tests/stage-01-handoff.test.mjs` 的公共模块动态导入会因缺少 `marked` 被阻塞；模块清单和不依赖第三方包的交接断言已通过。依赖完整验证由 GitHub CI 执行。

## 已知限制

- 本节点不替代 2.6 Modal Shell；兼容模态框仍使用原业务实现。
- Ubuntu 22.04 Chromium/Tauri 验证不能替代 Windows 原生 WebView、窗口、文件关联和系统拖放回归。
- 既有 2 个 npm audit advisory 不属于本节点，未修改依赖或锁文件。
