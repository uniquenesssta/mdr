# Stage 2 / Atomic Task 2.2：最小 index.html

## 状态

- 当前状态：最终收口复验中。
- 实施分支：`rewrite/modular-rebuild`。
- Atomic Task 2.3 尚未开始。

## 已实施内容

- `index.html` 仅保留标准文档 head、`#app-root` 和单一模块入口。
- 旧业务 DOM 迁移到唯一阶段兼容资产，由职责独立的挂载与启动模块加载。
- 冻结模型、持久化格式、依赖、锁文件、CSS、Rust 和既有用户行为保持不变。

## 收口阻塞与根因

Stage 0 run `30997931980` 的最终硬门禁失败。工件 `stage-00-baseline-30997931980-1` 证明唯一失败的必需检查是 `browser-app`：`npm run test:browser` 在启动浏览器前解析 `dist/index.html` 时，同时强制要求模块脚本和独立 `<link rel="stylesheet">`。2.2 将 CSS 保持为 `src/main.js` 模块图的一部分，而入口通过动态模块加载，因此 Vite 不再保证初始 HTML 含独立 stylesheet 标签；模块脚本、Node 测试、浏览器契约、构建、Rust 和 Tauri 链路本身均未失败。

首次收口验证 run `30999898039` 修复资产发现后，完整应用已启动并通过 7 项交互，随后捕获 `Identifier 'i18n' has already been declared`。原因是旧浏览器测试仍手动注入 `i18n.js`，而 2.2 模块入口已承担同一加载职责，形成测试侧与生产入口的双重所有权。该失败同样发生在提交前，未推送正式修复。

## 收口修复

- 新增 `tests/e2e/lib/built-application-assets.mjs`，单独负责解析构建入口资产。
- 模块脚本继续作为硬性契约；缺失时立即失败。
- 独立 stylesheet 标签改为可选：存在时仍单独加载，不存在时由真实模块图加载 CSS。
- 删除浏览器测试对 `i18n.js` 的手动注入，由 `src/bootstrap/module-entry.js` 保持唯一加载所有权。
- `tests/e2e/run-browser-tests.mjs` 继续真实导入构建模块、等待 `app-ready`、验证 E2E bridge 并执行完整应用交互回归，不跳过、不弱化失败。
- 新增 `tests/built-application-assets.test.mjs`，覆盖模块图 CSS、独立 stylesheet 兼容和模块入口缺失三条路径。

## 验证

提交前执行：`npm test`、四项架构验证、`npm run test:browser:contract`、`npm run build`、`npm run test:browser`。最终 Stage 2、Stage 1 和 Stage 0 run 信息将在清理临时流程后的最终分支头复验通过后写入。

## 已知限制

- Ubuntu 22.04 CI 不替代 Windows 原生窗口、文件关联和系统拖放真实验证。
- 本节点不处理既有 npm audit advisory，也不修改依赖或锁文件。
