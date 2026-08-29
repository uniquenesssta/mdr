# Stage 2 / Atomic Task 2.9：样式分层与命名规范

## 状态

- 当前状态：实现完成，本地不依赖第三方包的专项验证通过；GitHub Stage 2、Stage 1、Stage 0 硬门禁待执行。
- 实施分支：`rewrite/modular-rebuild`。
- 2.8 最终基线：`7c9bf773567a1302191e84cea78e00a10e0bbcca`。
- 下一节点：Atomic Task 2.10 尚未开始。

## 任务边界

本节点严格执行任务书 2.9，只负责：

1. 将现有规则逐条迁移为 reset、shell、layout、component 和 feature 职责模块；
2. 建立 `.c-*`、`.l-*`、`.f-*`、`.is-*`、`.has-*` 命名契约；
3. 消除视觉 ID 选择器、跨独立 Feature 的深层选择器和稳定内联样式；
4. 保持 2.7 语义令牌、2.8 亮暗主题、App Shell、Modal Shell 和现有业务行为兼容。

Atomic Task 2.10 才负责 1280、900、720、600 宽度及 480 高度的多视口响应式验收。本节点没有提前迁移业务 Feature、主题状态服务、公共接口、持久化或桌面平台行为。

## 影响分析

### 直接入口

- 单一样式入口：`src/styles/index.css`；
- 旧合并样式：`src/styles/main.css`；
- App Shell class 生产者：`src/ui/shell/*.js`；
- 兼容 DOM：`public/compatibility/current-shell.html`；
- 状态 class 写入者：`public/app/bootstrap.js`、`public/app/core.js`、`public/app/editor-tools.js`、`src/runtime/link-preview.js`；
- 稳定生成样式调用者：预览、导出、Preview Worker、混合编辑剪贴板和 Mermaid 展示链路。

### 必须保持不变

- DOM ID 继续作为既有行为端口和可访问性引用；
- 经典脚本现有查询 class 暂时保留；
- Modal Shell 的展示生命周期和原有 `style.display` 恢复契约不变；
- 运行时侧栏宽度、分栏拖动、导出捕获、动态几何和用户富文本样式仍由原状态所有者写入；
- 主题、布局、设置、持久化、错误语义、Rust/Tauri 接口和冻结模型保持不变。

## 实施内容

### 1. 删除合并样式权威

删除 4,780 行的 `src/styles/main.css`。`src/styles/index.css` 成为唯一有序加载权威，固定导入 51 个职责模块；包括入口在内共有 52 个样式文件：

- foundation：5 个，分别为 reset、tokens、typography、accessibility、motion；
- themes：2 个，分别为 light、dark；
- shell：6 个，分别为 app-shell、menu-bar、toolbar-shell、workspace-shell、status-bar、window-controls；
- layout：6 个，分别为 sidebar-layout、split-pane、resize-state、compact-shell、compact-split、fullscreen；
- components：12 个，分别为 icon、menu、form、tabs、color-picker、table-picker、modal、progress、badge、drop-overlay、toast、link-preview；
- features：20 个，分别覆盖侧栏导航/文档/大纲、编辑器、预览、导出、媒体、内容展示、偏好、设置、帮助、混合编辑及其 HTML/媒体/表格/代码/Mermaid/数学子模块、共享代码展示和文件树。

生产模块清单由 91 增至 138。每个非令牌/主题文件首部声明单一责任；当前最大职责文件 `src/styles/features/hybrid.css` 为 342 行，测试硬门禁限制所有职责文件不得超过 380 行。

### 2. 重新校正真实职责边界

首轮机械切块后执行了逐文件责任复核，并修正了跨边界规则，包括：

- App Shell、菜单栏、工具栏、工作区、状态栏和 overlay 规则归回对应 shell 文件；
- 侧栏结构、文档列表和大纲树拆为三个独立 Feature 文件；
- 表单、标签页、颜色选择器、表格选择器、徽章、进度、拖放遮罩和链接预览归入独立组件；
- 偏好、设置和帮助拆分；
- 混合编辑按 HTML、媒体、表格、代码、Mermaid、数学和共享代码展示继续细分；
- resize 状态与普通 split-pane 几何分离。

测试对已发现的错误归属建立反向门禁，防止后续把规则再次放回相邻但错误的模块。

### 3. 命名契约

新视觉权威使用：

- `.l-*`：App Shell 和布局结构，例如 `.l-app-shell`、`.l-workspace`、`.l-split-pane`；
- `.c-*`：稳定通用组件和组件变体，例如 `.c-modal--narrow`、`.c-color-swatch--text-blue`；
- `.f-*`：Feature 表面，例如 `.f-editor-surface`、`.f-preview-surface`；
- `.is-*`：局部状态，例如 `.is-hidden`、`.is-collapsed`、`.is-dragging`；
- `.has-*`：父级能力或打开状态，例如 `.has-link-preview`。

经典脚本仍使用旧 `.app`、`.workspace`、`.sidebar` 等 class 查询 DOM。为避免 2.9 越界成业务迁移，新壳同时保留这些旧 class 作为兼容查询钩子；所有分层 CSS 改用新前缀 class，旧 shell class 不再拥有视觉规则。经典脚本在过渡期同时写入旧状态和新 `.is-*`/`.has-*` 状态，保持现有查询语义并让新 CSS 成为唯一视觉权威。

### 4. ID 选择器和稳定内联样式清理

原视觉 ID 选择器已改为 class：

- `#editor` → `.f-editor-surface`；
- `#preview` → `.f-preview-surface`；
- `#filename`、`#importFile` → `.c-file-input`；
- 导出图片预览 ID → `.f-export-image-preview-*`；
- 状态消息 ID → `.f-status-message`。

ID 仍作为明确行为端口或可访问性引用存在，但 CSS 不再使用 ID。

`public/compatibility/current-shell.html` 中固定 `style=` 全部删除：

- 18 个文字/高亮色板使用亮色主题命名令牌和 `.c-color-swatch--*`；
- 模态框固定宽度使用 `.c-modal--narrow/medium/wide/preview`；
- 网页抓取表单行、代理输入、状态、手动输入区域使用明确组件/状态类；
- 导出图片预览初始隐藏使用 `.is-hidden`。

同时移除了生产代码中可静态表达的样式字符串：

- 回退预览 `<pre style=...>` 改为 `.f-raw-fallback`；
- 剪贴板缓冲 textarea 的固定定位/透明度改为 `.c-clipboard-buffer`；
- Mermaid SVG 的固定尺寸/背景改为 `.f-mermaid-svg`；
- 预览源和预览面板的稳定显示切换改用 `hidden` 属性。

运行时测量、侧栏/分栏拖动几何、导出克隆与图片捕获、文件树深度和富文本用户样式仍保留动态 style 写入，因为这些值来自运行时数据而非稳定视觉权威。Modal Shell 的内联 display 也保持不变，以保护 2.6 已冻结的打开、关闭和原值恢复契约。

### 5. 主题和行为兼容

- 2.8 既有亮暗主题值保持不变；仅新增 18 个命名编辑器色板令牌，用于移除 HTML 颜色内联值；
- `data-theme`、localStorage key、Mermaid 协调和设置行为未迁移；
- 未修改公共业务接口、错误语义、持久化格式、Rust、Tauri 配置、依赖或锁文件；
- 2.9 没有新增生产依赖。

## 测试与证据

新增 `tests/ui/style-test-utils.mjs`，集中提供样式入口、CSS 结构解析、选择器拆分和令牌读取测试工具。

新增 `tests/ui/style-layering.test.mjs`，锁定：

- `main.css` 不存在，51 个模块按固定顺序加载；
- 各层模块数量、首部责任说明和不超过 380 行的文件边界；
- 已发现的跨文件错位规则不得回归；
- CSS 结构完整；
- 视觉选择器无 ID；
- 旧 shell class 不再作为视觉权威；
- 选择器不跨独立 `.f-*` Feature 命名空间；
- 兼容 HTML 无稳定内联样式；
- 稳定回退 `<pre>`、剪贴板 textarea 和 Mermaid SVG 不再写内联视觉样式；
- 新旧 class 过渡边界和 `.is-*`/`.has-*` 状态写入明确。

同步更新：

- `tests/ui/css-tokens.test.mjs`：从 51 个导入模块汇总令牌和颜色字面量；
- `tests/ui/themes.test.mjs`：锁定主题在所有 shell、layout、component 和 feature 规则前加载；
- `tests/ui/app-shell.test.mjs`：锁定新前缀 class 与兼容钩子并存；
- `tests/e2e/run-browser-tests.mjs`：真实应用几何采样改用新视觉 class；
- `tests/browser-e2e-contract.test.mjs`：继续锁定 App Shell 和主题几何场景；
- `tests/architecture/fixtures/production-modules.json`：生产模块数更新为 138；
- `scripts/stage-02/record-ui-foundation-evidence.mjs`：生成 `02-09-style-layering-evidence.json` 并记录依赖审计延期决策；
- `.github/workflows/stage-02-atomic.yml`：新增 2.9 专项和 `02-09` 架构证据路径。

## 当前验证结果

已实际执行并通过：

- `node --test tests/ui/style-layering.test.mjs tests/ui/css-tokens.test.mjs tests/ui/themes.test.mjs`：12/12；
- 2.1–2.9 不依赖第三方包的专项与浏览器契约组合：41/41；
- 修改的经典脚本、运行时脚本、测试和证据脚本 `node --check`：通过；
- CSS 模块结构、文件边界、视觉 ID、跨 Feature 选择器、颜色字面量、稳定生成样式和 HTML 内联样式门禁：通过；
- `git diff --check`：通过；
- 本地证据生成：通过，记录生产模块 138、导入样式 51、层数量 foundation 5 / themes 2 / shell 6 / layout 6 / components 12 / features 20。

本地未完成：

- 完整架构扫描、完整 Node、生产构建和构建后浏览器测试；原因是当前容器无法完成 npm 依赖安装，缺少第三方运行依赖；
- 未通过修改依赖、锁文件或测试门禁绕过；完整验证将在 GitHub Runner 执行。

## 依赖审计记录

继续记录当前依赖树的既有审计结果：`1 low / 1 high`。

按用户明确决定：

- Atomic Task 2.9 不修改依赖或锁文件；
- 不执行 `npm audit fix` 或 `npm audit fix --force`；
- 待全部任务完成后的本地真实运行测试阶段，由用户结合实测结果再决定是否处理。

## 已知限制与下一节点

- 旧 shell class 仍作为经典脚本兼容查询钩子存在，删除它们必须与对应业务 Feature 迁移在同一受审节点完成；
- 多尺寸响应式和低高度布局的正式验收属于 Atomic Task 2.10，本节点未宣称完成；
- Windows WebView、原生窗口、文件关联和系统拖放仍需在最终真实平台测试阶段验证；
- GitHub Stage 2、Stage 1、Stage 0 结果将在验证完成后写回本记录和 README。
