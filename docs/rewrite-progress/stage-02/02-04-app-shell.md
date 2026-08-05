# Stage 2 / Atomic Task 2.4：App Shell

## 状态

- 当前状态：完成。
- 实施分支：`rewrite/modular-rebuild`。
- 实施起点：`523b596c090464c5ded4353c4c725514a029f159`。
- 实现代码提交：`660c0e22312f41885ca6c86078b2f0189541d5e9`。
- 首轮清理验证头：`b5bc87719e71b9ac27c0bc2512ba9121a4e24d07`。
- Atomic Task 2.5 尚未开始。

## 实施内容

- 新增 `src/ui/create-ui.js`，提供 `createUI(root)`，严格返回 `menu/toolbar/sidebar/editor/preview/status/overlay` 七个命名引用和幂等 `destroy()`。
- 新增 `src/ui/shell/` 下 7 个职责模块：App Shell 组合、顶部菜单、工具栏、侧栏、工作区、状态栏和 overlay root。
- App Shell 只创建 DOM 结构、稳定 ID/class、ARIA 区域和临时 DOM 引用；不读取业务 store，不绑定事件，不访问模型、平台或持久化。
- 工作区由单一模块拥有侧栏分隔条、编辑槽、编辑/预览分隔条和预览槽；现有 `#sidebar`、`#sidebar-resizer`、`#editor`、`#resizer`、`#preview` 调用链保持可用。
- `public/compatibility/current-shell.html` 从旧 `.app` 壳改为 8 个显式模板：`menu/toolbar/sidebar/editor/preview/status/overlay/ports`。模板只保留尚未迁移的业务内容，不再定义 App Shell 包装结构。
- `mount-current-shell.js` 只负责校验模板、调用 `createUI`、将内容挂入严格 refs、恢复主题并在销毁时完整恢复 `#app-root`。
- 上下文菜单、模态框、拖放遮罩、toast 和离屏导出节点暂时保留在兼容 overlay 模板；其行为分别仍归 2.5、2.6 和后续 Feature 迁移，不在本节点重写。
- 更新机器可读生产模块清单，当前记录由 71 增至 79；Stage 1 历史交接中的 67 个模块事实保持不变。
- 永久 Stage 2 CI 新增 2.4 专项契约和 `02-04-app-shell-evidence.json` 结构化证据。

## 兼容性与所有权

- 保留 184 个既有内联事件、35 个图标 ID、50 个兼容壳图标引用以及全部业务 DOM ID。
- 旧兼容壳与新壳/模板等价性检查确认：138 个旧业务 ID、139 个旧 class 均无遗漏，仅新增 `#overlay-root/.overlay-root`。
- 保留旧经典脚本、`src/main.js`、i18n、编辑器、预览、文件端口和 overlay 功能调用顺序。
- 生产运行时只有新 App Shell 一套壳结构；兼容文件只提供业务内容模板，不再形成第二套权威壳。
- `createUI(root)` 对同一 root 只允许一个活动挂载；销毁幂等，并恢复原始子节点和 hidden 状态。
- 未修改 CSS 视觉规则、Rust、依赖、锁文件、配置、冻结模型、持久化结构、错误码或安全策略。

## 验证结果

### 本地依赖无关验证

- `node --test tests/ui/app-shell.test.mjs tests/ui/minimal-index.test.mjs tests/svg-sprite.test.mjs tests/ui/dom-asset-inventory.test.mjs`：12/12 通过。
- `node --test tests/architecture/module-inventory.test.mjs`：3/3 通过。
- 新增生产模块与浏览器测试 `node --check`：通过。
- 184 个内联事件、50 个兼容图标引用和 35 个 Sprite ID 保持不变。
- `npm run verify:no-legacy-runtime`、`npm run verify:generated-files`、`npm run verify:readme-record`：通过。
- `git diff --check`：通过。
- 本地 `npm ci --ignore-scripts` 被当前容器内部 npm 镜像缺少 `w3c-keyname@2.2.8` 阻塞；没有修改依赖或锁文件，完整依赖验证由 GitHub CI 成功执行。

### 隔离实施验证

临时快照 run `31007507105` 通过，用于在容器无法 DNS clone GitHub 时取得完整、带 `.git` 的只读仓库快照：

- 工件：`stage-02-04-repository-snapshot-31007507105`
- 工件 ID：`8930948193`
- 摘要：`sha256:4c34ec13f885ca86d923118916e652fe998115c5e99eb7a10c4b596d3c147aff`

隔离实施 run `31009451509` 全部通过后提交代码实现 `660c0e22312f41885ca6c86078b2f0189541d5e9`，覆盖：

- `npm ci`
- 2.1–2.4 专项契约与生产模块所有权
- 完整 `npm test`
- 四项架构门禁
- 浏览器交互契约
- 生产构建
- 构建后完整应用浏览器回归
- `.github` 传输文件与工作流变更排除检查

### 首轮正式三层验证

清理验证头 `b5bc87719e71b9ac27c0bc2512ba9121a4e24d07`：

- Stage 2 Atomic Verification：run `31009862503`，通过。
  - 工件：`stage-02-ui-foundation-31009862503-1`
  - 工件 ID：`8931955263`
  - 摘要：`sha256:6af7510e21fa73a8b876758d676b9f63cd8266ec8f23d95eccd32158991b736a`
- Stage 1 Atomic Verification：run `31009862345`，通过。
  - 工件：`stage-01-architecture-foundation-31009862345-1`
  - 工件 ID：`8931952897`
  - 摘要：`sha256:40edd9eb9d5cb49a8cb8e9dcc38ea5ff650a9ed7cf9e89a9c18c2aa3181a3d89`
- Stage 0 Baseline Verification：run `31009863167`，通过。
  - 工件：`stage-00-baseline-31009863167-1`
  - 工件 ID：`8932194126`
  - 摘要：`sha256:c103a515601b78d87db8c0f3413089c8306af4e988898d7b305a8f2ad068207d`

实际覆盖：2.1 DOM 盘点、2.2 最小入口、2.3 SVG Sprite、2.4 App Shell/严格 refs、模块所有权、架构硬门禁、Node 回归、浏览器交互契约、前端生产构建、构建后完整应用浏览器回归、`cargo test --locked`、`cargo check --locked`、Tauri Linux release build、工件上传和最终硬门禁。

浏览器完整应用回归要求：只存在一个 `[data-ui-shell="app"]`，七个严格插槽各一个，旧业务 ID 无重复，设置模态框位于 `#overlay-root`，隐藏文件端口仍位于 `#app-root`，并继续执行既有布局和编辑/预览交互回归。

## 过程故障与处理

- 首次实施 run `31008583802` 在应用补丁前失败：单文件 base64 传输被截断，出现 `base64: invalid input` 和 `gzip: unexpected end of file`；正式实现未进入分支，后续验证被正确阻断。改为 6 段传输并锁定总长度 23,024 字节。
- 第二次实施 run `31009226922` 的补丁应用、Node、架构、浏览器和构建验证全部通过，但 GitHub Actions 令牌无 `workflows` 权限，拒绝推送永久工作流更新；该 run 未向分支写入实现。随后将已验证代码提交与工作流更新拆开处理。
- 第三次实施 run `31009451509` 重复全部验证并成功推送仅包含非工作流实现的代码提交；永久 Stage 2 CI 由 GitHub 连接器单独更新。
- 所有临时补丁分段、base64 载荷、快照工作流和实施工作流均已删除，不属于最终净树。

## 已知限制

- 本节点未实现 2.5 DOM 原语、2.6 Modal Shell 或 2.7 之后的 CSS 迁移。
- Ubuntu 22.04 Chromium/Tauri 验证不替代 Windows 原生 WebView、窗口控制、文件关联和系统拖放的真实平台回归。
- 既有 2 个 npm audit advisory 不属于本节点，未修改依赖或锁文件。
