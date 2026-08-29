# Stage 2 / Atomic Task 2.10：响应式壳验证

## 结果

Atomic Task 2.10 为 App Shell 建立可重复的多视口结构验收。验证范围固定为 `1280 / 900 / 720 / 600` 四个宽度和 `480` 短高度；只检查壳层布局、结构溢出和可见焦点可达性，不新增或推断业务响应式行为。

## 实施内容

- 在 `tests/e2e/lib/cdp-browser.mjs` 增加有界 `setViewport()`，通过 Chromium DevTools Protocol 设置真实浏览器视口并校验宽高参数。
- 在完整应用浏览器回归中增加六组确定性矩阵：`1280×800`、`900×700`、`720×700`、`600×700`、`900×480`、`600×480`。
- 每组视口记录 App Shell、菜单栏、工具栏、工作区、分栏主体和状态栏的边界、client/scroll 尺寸、flex 方向及 compact 状态。
- 逐个聚焦当前可见的菜单、工具栏和面板折叠控件，检查焦点是否位于视口内以及是否被任一 overflow 祖先裁切。
- 浏览器结果写入 `artifacts/stage-02/browser-app/responsive-shell-report.json`，Stage 2 证据生成器在报告存在时重新校验矩阵、溢出和焦点问题，再生成 `02-10-responsive-shell-evidence.json`。
- `sidebar-layout.css` 与 `compact-split.css` 仅补齐 flex 子项的 `min-width/min-height: 0` 收缩边界；`status-bar.css` 只约束状态栏内部收缩和稳定文本项，避免短宽度把壳层撑出视口。
- Stage 2 工作流增加 2.10 专项测试，并在完整应用浏览器回归之后生成证据，确保记录来自实际构建结果。

## 保持不变

- 未修改文档、编辑、预览、保存、导出或其他业务行为。
- 未修改冻结模型、公共接口、持久化格式、Rust/Tauri 配置、依赖或锁文件。
- 主题、布局模式和侧栏状态仍由原有权威链路拥有；本任务只验证并修复壳层结构边界。
- 依赖审计仍记录既有 `1 low / 1 high`，按用户决定留到全部任务完成后的本地真实运行测试阶段再决定。

## 验证

### 当前容器

- `node --check tests/e2e/lib/cdp-browser.mjs`
- `node --check tests/e2e/run-browser-tests.mjs`
- `node --check scripts/stage-02/record-ui-foundation-evidence.mjs`
- `node --test tests/ui/responsive-shell.test.mjs`
- 相关 Stage 2 静态/契约回归
- `git diff --check`

当前容器的 npm 镜像缺少锁文件要求的 `w3c-keyname@2.2.8` 和 `vite@7.3.6`，因此本地未安装完整依赖；完整依赖、构建与真实浏览器验证已由 GitHub Actions 完成。

### GitHub 受控验证

- Run：`31074995344`，attempt `1`，结果 `success`。
- 环境：Node `22.23.1`、npm `10.9.8`、Ubuntu 22.04、Chromium。
- Atomic Task 2.1–2.10 专项：通过；其中 2.10 专项 `4/4`。
- 架构硬门禁：通过，生产模块记录保持 `138/138`。
- Node 回归：`36/36`。
- 浏览器交互契约：`9/9`。
- Vite 生产构建：通过，转换 `2178` 个模块；仅保留既有大 chunk 警告。
- 构建后真实应用回归：`12/12`。
- 响应式矩阵：六组视口全部通过；实际宽高与要求一致，页面滚动均为 `0,0`，文档与 body 横向尺寸均未超过视口，`viewportIssues = 0`、`focusIssues = 0`，每组检查 29 个可见焦点目标。
- compact 状态：`1280×800`、`900×700`、`900×480` 为非 compact；`720×700`、`600×700`、`600×480` 为 compact 且侧栏隐藏，均符合契约。
- 证据制品：`atomic-2-10-controlled-31074995344-1`，artifact ID `8957141798`，包含 `responsive-shell-report.json`、`02-10-responsive-shell-evidence.json` 和架构扫描。
- npm 安装仍报告既有 `1 low / 1 high`；本任务未改依赖，按用户决定延后至全部任务完成后的本地真实运行测试阶段处理。

## 边界与后续

- 本任务不引入新的断点业务逻辑，只验收现有 compact-shell 和布局规则在规定视口下的结构表现。
- Atomic Task 2.11（旧壳切换）尚未开始。
