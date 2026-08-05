# Stage 2 / Atomic Task 2.5：DOM 原语

## 状态

- 当前状态：完成。
- 实施分支：`rewrite/modular-rebuild`。
- 2.4 最终验证基线：`adc068df47f2a9f6198c20458cb1a0c46246787a`。
- 实现代码提交：`9f3f4cbbdba992944cf93e0b275da9634d59007f`。
- 首轮正式清理验证头：`77ee167155dc3e36915cf8df15dc449dd3191898`。
- Atomic Task 2.6 尚未开始。

## 任务边界

本节点只实现以下五类 DOM 基础职责：

1. 安全元素创建。
2. 必需元素引用校验。
3. 事件监听作用域与清理。
4. 初始焦点、Tab 约束、焦点恢复和销毁。
5. 过渡可见性、超时完成和过时隐藏结果取消。

本节点未实现 Modal Shell、具体模态框字段、提交行为、Escape/遮罩业务策略、CSS 令牌、主题或样式分层。

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

- `safe-element.js`：只接受显式 `id/className/text/attributes/dataset`；拒绝 `base/embed/link/meta/object/script/style` 等可执行标签，拒绝 `on*`、`srcdoc`、`style`、未声明选项和可执行 URL 协议，不提供 `innerHTML` 接口。
- `required-refs.js`：校验元素引用并从明确 selector 契约收集冻结 refs；缺失引用立即以名称和 selector 报错。
- `event-scope.js`：登记监听器、返回幂等单项 disposer、逆序销毁全部监听器、销毁后禁止继续注册，并聚合清理异常。
- `focus-scope.js`：拥有初始焦点、可选 Tab 约束、原焦点恢复和幂等销毁；不拥有 Escape 或模态业务语义。
- `transition-visibility.js`：拥有可见 class、`aria-hidden`、`transitionend`/超时完成、重新显示时取消过时隐藏结果和幂等销毁。

### 调用链切换

- `src/ui/create-ui.js` 使用必需引用校验处理 `#app-root`。
- `src/ui/shell/*.js` 全部通过公共入口使用安全元素创建，不再分别重复 document 校验和直接 `createElement()`。
- `src/ui/compatibility/mount-current-shell.js` 使用安全模板元素和必需挂载目标校验；兼容 markup 的受控模板解析仍由该模块单独拥有。
- `src/runtime/link-preview.js` 使用安全元素创建、事件作用域、焦点作用域和过渡可见性；关闭后立即重开会取消旧隐藏完成结果，旧计时器不会清空新 iframe 或恢复过时焦点。
- 生产调用者只导入 `src/ui/dom/index.js`，不绕过公共入口访问内部原语文件。

## 模块、接口与兼容性

- 机器可读生产模块记录由 79 增至 85。
- 新增 6 个 `ui-dom` 模块，其中 5 个职责模块和 1 个公共 facade。
- 既有 8 个 `ui-shell` 模块职责不变。
- 保留 184 个兼容内联事件、35 个图标 ID、50 个兼容图标引用、App Shell 七个严格 refs 和全部业务 DOM ID。
- 链接预览既有全局接口 `open/close/openExternal/isOpen` 保持不变。
- 未修改 CSS、Rust、依赖、锁文件、配置、冻结模型、持久化结构、错误码或安全策略。

## 验证结果

### 依赖无关与隔离实施验证

- `node --test tests/ui/dom-primitives.test.mjs`：6/6 通过。
- 2.1–2.5 UI、模块所有权与浏览器契约合并验证：26/26 通过。
- 新增和修改的生产/测试 JavaScript `node --check`：通过。
- `npm run verify:no-legacy-runtime`、`npm run verify:generated-files`、`npm run verify:readme-record`：通过。
- `git diff --check`：通过。
- 隔离实施 run `31016417497` 全部通过并推送实现提交，覆盖 `npm ci`、2.1–2.5 专项契约、四项架构门禁、完整 `npm test`、浏览器契约、生产构建、构建后完整应用回归和修改范围检查。
- 构建后完整应用回归验证了链接预览初始焦点、Tab 环绕、关闭后立即重开不受旧隐藏结果影响，以及最终焦点恢复。

### 首轮正式三层验证

清理验证头 `77ee167155dc3e36915cf8df15dc449dd3191898`：

- Stage 2 Atomic Verification：run `31016721386`，通过。
  - 工件：`stage-02-ui-foundation-31016721386-1`
  - 工件 ID：`8934806937`
  - 摘要：`sha256:f27862061618d0647f0a014764255300da7b654334193600cae43181d1b239fa`
- Stage 1 Atomic Verification：run `31016721135`，通过。
  - 工件：`stage-01-architecture-foundation-31016721135-1`
  - 工件 ID：`8934806332`
  - 摘要：`sha256:cf2e891fb9fd01906eeeea909b172993ba0b07b575a1fb94c27831352bcd6977`
- Stage 0 Baseline Verification：run `31016724092`，通过。
  - 工件：`stage-00-baseline-31016724092-1`
  - 工件 ID：`8935108979`
  - 摘要：`sha256:0a5c42685946c58bb34132db29d7f8bf5cfd4938f0c0c95d9cdc86a0471fee6e`

实际覆盖：2.1 DOM 盘点、2.2 最小入口、2.3 SVG Sprite、2.4 App Shell、2.5 DOM 原语、模块所有权、架构硬门禁、完整 Node 回归、浏览器交互契约、前端生产构建、构建后完整应用浏览器回归、`cargo test --locked`、`cargo check --locked`、Tauri Linux release build、工件上传和最终硬门禁。

## 过程故障与处理

- 临时快照 run `31014090397` 通过，用于在当前容器无法直接 clone GitHub 时取得完整只读仓库；工件 ID `8933695121`，摘要 `sha256:7985aa3b94df324e1aa1dc505c9da75518e9b3d00a74270225557e9f6085ef2e`。快照工作流随后删除。
- 首次实施 run `31015801188` 在补丁应用前因输入头校验把工作流自身提交误判为偏移而失败；实现未进入分支，后续验证被正确阻断。校验改为受控祖先关系。
- 第二次实施 run `31015917665` 的补丁摘要和 `npm ci` 通过，但跟踪文件补丁遗漏新建的 DOM 模块、专项测试和阶段记录，合并专项契约因此失败；实现未进入分支。新增独立新文件补丁并分别锁定长度和双重 SHA-256。
- 第三次实施 run `31016417497` 重组两份补丁后通过全部验证并成功提交正式实现。
- 所有临时快照、补丁分段和实施工作流均已删除，不属于正式净树。
- 本地 `npm ci --ignore-scripts` 曾被内部 npm 镜像缺少 `w3c-keyname@2.2.8` 阻塞；未修改依赖或锁文件，GitHub CI 的锁文件安装和完整验证均成功。

## 已知限制

- 本节点不替代 2.6 Modal Shell；兼容模态框仍使用原业务实现。
- Ubuntu 22.04 Chromium/Tauri 验证不能替代 Windows 原生 WebView、窗口、文件关联和系统拖放回归。
- 既有 2 个 npm audit advisory（1 low、1 high）不属于本节点，未修改依赖或锁文件。
