# Stage 2 / Atomic Task 2.3：SVG Sprite

## 状态

- 当前状态：完成。
- 实现验证头：`69275601dd6b258f7dca287d3a83e933f2b8f695`。
- 实施分支：`rewrite/modular-rebuild`。
- 实施起点：`677b060ad583d1387add0271722019bfc9a41fca`。
- Atomic Task 2.4 尚未开始。

## 精确盘点

临时发现 run `31003118649` 通过，工件 `stage-02-03-icon-discovery-31003118649-1`（ID `8929125705`，摘要 `sha256:7e197f4bf94dffac40759f610f9ce7eb404f8b01a716189f6ee0c195455233fa`）记录：

- 35 个既有稳定图标 ID；全部符合 `icon-*` 小写连字符命名。
- 35 份真实几何原先全部由 `public/compatibility/current-shell.html` 内联拥有。
- 50 个兼容壳静态 `<use>` 引用。
- 7 个生产动态引用点，分布在经典脚本与 ESM 模块。
- 浏览器测试另有 4 个空 `<symbol>` 重复定义，构成第二套测试权威。
- 未发现缺失定义；静态未引用记录不作为删除依据，全部 35 个兼容 ID 均保留。

## 实施内容

- 新建 `public/assets/icons.svg`，逐字保留原 35 个 `<symbol>` 的 ID、`viewBox` 和几何；文件不包含脚本、内联事件、业务标签、ARIA 文案或 `data-*` 行为属性。
- 从兼容壳删除内联 Sprite，全部 `<use>` 改为 `/assets/icons.svg#icon-*`。
- 新建 `src/ui/components/icon-view.js`：只负责 ID 校验、href 生成、SVG DOM 创建和装饰性/有标签两种可访问性输出，不持有状态，不绑定监听器，不访问业务 store。
- `src/runtime/link-preview.js` 与 `src/sidebar/folder-file-tree.js` 改为依赖该公共渲染入口；文件树删除本地重复 `createIcon()`。
- 经典脚本 `public/app/core.js`、`public/app/events.js` 无法反向导入 ESM UI 模块，因此只引用同一个外部 Sprite URL，不复制几何。
- 浏览器契约删除 4 个测试内联符号，改为真实外部 Sprite 引用并断言生成 href。
- 新增可复用静态检查器与 `tests/svg-sprite.test.mjs`，锁定 ID 集合、唯一性、无业务标记、单一几何权威、调用者依赖和 `icon-view` 公共契约。
- 更新生产模块所有权清单；当前机器可读生产模块记录由 70 增至 71，Stage 1 历史交接中的 67 个模块事实保持原样。
- 永久 Stage 2 CI 新增 2.3 专项契约与 `02-03-svg-sprite-evidence.json`，不再错误声明 2.3 尚未开始。

## 变更边界

本节点未创建 App Shell、菜单槽、工具栏槽、侧栏槽、工作区槽、状态栏槽或 overlay；未开始 2.4。未修改 CSS 视觉规则、冻结模型、持久化、Rust、依赖、锁文件、配置、错误码、安全策略或用户可观察行为。

## 验证结果

提交前实施工作流 run `31003682731` 通过：

- `node --test tests/svg-sprite.test.mjs`
- `node --test tests/ui/minimal-index.test.mjs`
- `npm test`
- 四项架构验证命令
- `npm run test:browser:contract`
- `npm run build`
- `npm run test:browser`

临时流程清理后的实现验证头 `69275601dd6b258f7dca287d3a83e933f2b8f695`：

- Stage 2 Atomic Verification：run `31004015345`，通过。
  - 工件：`stage-02-ui-foundation-31004015345-1`
  - 工件 ID：`8929520978`
  - 摘要：`sha256:be9b2634745d127e13cc2e0f12c06752f1f99171fe3fd88f4be134f08e8b383f`
- Stage 1 Atomic Verification：run `31004015370`，通过。
  - 工件：`stage-01-architecture-foundation-31004015370-1`
  - 工件 ID：`8929519173`
  - 摘要：`sha256:6e2143b5156275bf70b58b54bba4f261001ea0c6302d3c022c147fa186a41b55`
- Stage 0 Baseline Verification：run `31004015506`，通过。
  - 工件：`stage-00-baseline-31004015506-1`
  - 工件 ID：`8929862551`
  - 摘要：`sha256:d6bc63969e068bbe6d30fc7f244956e4b48b71766cf58e15a162e01bca05c46e`

实际覆盖：2.1 历史盘点、2.2 最小入口、2.3 Sprite/图标视图契约、模块所有权、架构硬门禁、Node 回归、浏览器交互契约、前端生产构建、构建后完整应用浏览器回归、`cargo test --locked`、`cargo check --locked`、Tauri Linux release build、工件上传和最终硬门禁。

## 兼容性与删除条件

- 35 个图标 ID、`viewBox`、路径几何和现有 CSS class 保持不变。
- 外部 Sprite 是唯一几何权威；经典脚本仅允许引用其 URL，不得复制图形定义。
- `public/compatibility/current-shell.html` 中的旧图标定义已删除，不再是回滚或兼容权威。
- 外部 Sprite 的兼容 ID 只有在对应调用者迁移、精确引用基线缩减和完整回归于同一受审变更中完成后才能删除。

## 已知限制

- Ubuntu 22.04 CI 不替代 Windows 原生 WebView 对外部 SVG `<use>` 的真实平台回归；当前自动化证据包括 Chromium 完整应用回归和 Tauri Linux release build。
- 既有 2 个 npm audit advisory 不属于本节点，未修改依赖或锁文件。
- 静态扫描不能证明所有运行时组合 ID 的业务可达性，因此保留全部 35 个既有稳定 ID，不以“静态未引用”作为删除依据。
