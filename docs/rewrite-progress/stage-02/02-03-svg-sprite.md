# Stage 2 / Atomic Task 2.3：SVG Sprite

## 状态

- 当前状态：实现完成，最终三层复验待清理临时流程后执行。
- 实施分支：`rewrite/modular-rebuild`。
- 实施起点：`677b060ad583d1387add0271722019bfc9a41fca`。
- 实施工作流输入头：`9aff8f25dd8eef818edd198fb5c2354769dd273a`。
- Atomic Task 2.4 尚未开始。

## 精确盘点

临时发现 run `31003118649` 通过，工件 `stage-02-03-icon-discovery-31003118649-1`（ID `8929125705`，摘要 `sha256:7e197f4bf94dffac40759f610f9ce7eb404f8b01a716189f6ee0c195455233fa`）记录：

- 35 个既有稳定图标 ID；全部符合 `icon-*` 小写连字符命名。
- 35 份真实几何原先全部由 `public/compatibility/current-shell.html` 内联拥有。
- 50 个兼容壳静态 `<use>` 引用。
- 7 个生产动态引用点，分布在经典脚本与 ESM 模块。
- 浏览器测试另有 4 个空 `<symbol>` 重复定义，构成第二套测试权威。
- 未发现缺失定义；静态未引用记录不作为删除依据，全部 35 个兼容 ID均保留。

## 实施内容

- 新建 `public/assets/icons.svg`，逐字保留原 35 个 `<symbol>` 的 ID、`viewBox` 和几何；文件不包含脚本、内联事件、业务标签、ARIA 文案或 `data-*` 行为属性。
- 从兼容壳删除内联 sprite，全部 `<use>` 改为 `/assets/icons.svg#icon-*`。
- 新建 `src/ui/components/icon-view.js`：只负责 ID 校验、href 生成、SVG DOM 创建和装饰性/有标签两种可访问性输出，不持有状态，不绑定监听器，不访问业务 store。
- `src/runtime/link-preview.js` 与 `src/sidebar/folder-file-tree.js` 改为依赖该公共渲染入口；文件树删除本地重复 `createIcon()`。
- 经典脚本 `public/app/core.js`、`public/app/events.js` 无法反向导入 ESM UI 模块，因此只引用同一个外部 Sprite URL，不复制几何。
- 浏览器契约删除 4 个测试内联符号，改为真实外部 Sprite 引用并断言生成 href。
- 新增可复用静态检查器与 `tests/svg-sprite.test.mjs`，锁定 ID 集合、唯一性、无业务标记、单一几何权威、调用者依赖和 `icon-view` 公共契约。
- 更新生产模块所有权清单；当前机器可读生产模块记录由 70 增至 71，Stage 1 历史交接中的 67 个模块事实保持原样。

## 变更边界

本节点未创建 App Shell、菜单槽、工具栏槽、侧栏槽、工作区槽、状态栏槽或 overlay；未开始 2.4。未修改 CSS 视觉规则、冻结模型、持久化、Rust、依赖、锁文件、配置、错误码、安全策略或用户可观察行为。

## 提交前验证

实施工作流 run `31003682731` 仅在以下命令全部通过后提交正式实现：

- `node --test tests/svg-sprite.test.mjs`
- `node --test tests/ui/minimal-index.test.mjs`
- `npm test`
- 四项架构验证命令
- `npm run test:browser:contract`
- `npm run build`
- `npm run test:browser`

最终 Stage 2、Stage 1、Stage 0 run 与工件信息将在临时流程清理后的最终头复验完成后补录。

## 已知限制

- Ubuntu 22.04 CI 不替代 Windows 原生 WebView 对外部 SVG `<use>` 的真实平台回归；本节点以 Chromium 完整应用回归和后续 Tauri Linux release build 作为当前自动化证据。
- 既有 2 个 npm audit advisory 不属于本节点，未修改依赖或锁文件。
- 外部 Sprite 的 35 个兼容 ID在调用者迁移完成前均视为稳定公共资源，不得因静态暂未引用而提前删除。
