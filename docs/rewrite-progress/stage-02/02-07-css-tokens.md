# Stage 2 / Atomic Task 2.7：CSS 令牌

## 状态

- 当前状态：完成。
- 实施分支：`rewrite/modular-rebuild`。
- 2.6 最终基线：`b76956ab66df6cb2349354db816bba7f17dbcdae`。
- 2.7 实现验证头：`4e0b8a6c1df1be20af6be09987ae720a3e8e373b`。
- 下一节点：Atomic Task 2.8 尚未开始。

## 任务边界

本节点只建立 CSS 令牌职责及其单一公共入口：

1. 将颜色、字体族与字号、间距、圆角、阴影、层级、动效和代码展示值集中为语义令牌。
2. 令牌名称表达视觉角色或设计语义，不使用 left/right/top/bottom/sidebar/workspace/header/footer 等页面位置名称。
3. 保留现有亮色与暗色实际值、现有选择器、DOM、交互、布局和运行时可写 CSS 属性。
4. 将全部生产 CSS、HTML 内联样式和 JavaScript CSS 属性写入切换到新令牌名称。

Atomic Task 2.8 才负责把主题覆盖从令牌基础文件中进一步拆分；Atomic Task 2.9 才负责 reset、shell、layout 和 component 样式分层。本节点没有提前建立主题服务、主题文件体系或新的 class 命名规范。

## 实施内容

### 单一样式入口

新增 `src/styles/index.css`，只按以下固定顺序加载：

1. `foundation/tokens.css`
2. 当前合并样式 `main.css`

`src/main.js` 只导入该公共入口，不再直接依赖 `main.css`。样式入口不包含具体组件规则或主题切换逻辑。

### 单一令牌权威

新增 `src/styles/foundation/tokens.css`，集中拥有：

- `--color-*`：画布、表面、文本、边框、强调、状态、遮罩和兼容展示颜色；
- `--font-family-*`、`--font-size-*`：UI、正文、编辑器、等宽字体和稳定字号；
- `--space-*`：稳定间距尺度；
- `--radius-*`：控件、卡片、弹层和圆形边界尺度；
- `--shadow-*`：低层、抬升、浮层、遮罩层及焦点/控件阴影；
- `--layer-*`：抬升、吸附、菜单、弹层、模态框、上下文菜单和链接预览层级；
- `--motion-duration-*`、`--motion-ease-*`：现有持续时间与缓动；
- `--code-*`：代码背景、边框、工具栏、行号和语法令牌颜色。

旧 `main.css` 中两份 `:root` 和暗色令牌覆盖已删除，不再存在第二份令牌权威。现有 `[data-theme="dark"]` 值暂时与基础令牌同文件保存，仅用于维持 2.8 开始前的现有主题行为。

### 调用者迁移

- `src/styles/main.css` 的旧颜色、字体、间距、圆角、阴影、层级、动效和代码变量引用已切换为语义令牌。
- `main.css` 不再保存颜色字面量；颜色值只由令牌文件提供。
- `public/app/core.js` 的编辑器文本色与活动行写入切换为 `--color-editor-text`、`--color-editor-active-line`。
- `public/app/export.js`、`public/app/web-clipper.js` 和 `public/compatibility/current-shell.html` 的旧变量引用已切换。
- `--sidebar-width`、`--editor-font-size`、`--indicator-color`、`--swatch-color`、`--tree-depth` 仍是运行时或局部状态，不并入全局设计令牌，也未改变其写入语义。

### 契约测试与架构证据

新增 `tests/ui/css-tokens.test.mjs`，锁定：

- 唯一入口及固定加载顺序；
- 唯一 `:root` 令牌权威；
- 八类必需令牌；
- 禁止页面位置式令牌命名；
- 暗色覆盖只能覆盖已存在的基础令牌；
- 关键亮暗值保持不变；
- 生产 CSS/HTML/JS 不再引用旧令牌；
- `main.css` 不再包含颜色字面量；
- 所有 `var()` 引用必须由令牌、当前局部属性或明确运行时属性提供。

机器可读生产模块记录由 87 增至 89，新增 `presentation-entry` 与 `presentation-tokens` 两个独立职责。Stage 2 工作流新增 2.7 专项测试及 `02-07-css-tokens-evidence.json`。

## 接口、行为与兼容性

- DOM ID、class、选择器、内联事件、App Shell refs、Modal Shell 接口和 Feature 行为保持不变。
- 现有亮暗主题实际基础值保持不变；没有增加第三种主题或新的主题状态所有者。
- 现有运行时可写编辑器颜色、字号和侧栏宽度属性保持可写。
- 未修改 Rust、Tauri 配置、依赖、锁文件、环境变量、持久化、冻结模型或数据格式。
- 本节点没有拆分 `main.css` 中的组件规则，避免越过 Atomic Task 2.9 边界。

## 当前验证结果

### 本地与受控实现验证

- `node --test tests/ui/css-tokens.test.mjs`：3/3 通过。
- 2.1–2.7 阶段专项：31/31 通过。
- 完整 Node 回归：36/36 通过。
- 架构硬门禁、修改文件语法检查、CSS 令牌引用完整性、工作流 YAML、证据脚本语法和 README 记录检查：通过。
- 受控 Runner 完成浏览器契约、生产构建和构建后浏览器回归；实现发布步骤仅因 GitHub App 无权直接推送工作流文件而改用 Git 对象接口，未绕过任何代码或验证门禁。
- 本地 `npm ci` 曾被内部 npm 镜像缺少已声明的 `w3c-keyname@2.2.8` 阻塞；GitHub Runner 使用正常依赖源成功执行 `npm ci`，未修改依赖或锁文件绕过。

### GitHub 三层硬门禁

- Stage 2 run `31029253144`：成功。首次浏览器步骤因 Chromium CDP 端点未就绪失败，仅重跑原失败任务后通过；没有修改源码、重试策略或降低门禁。
- Stage 1 run `31029252663`：成功。
- Stage 0 run `31029252956`：成功。
- 覆盖结果：31/31 阶段专项、36/36 Node、架构扫描、9/9 浏览器契约、生产构建、10/10 构建后浏览器、Rust test、Rust check、Tauri Linux build 全部通过。
- `npm ci` 审计仍报告既有 2 项依赖漏洞（1 low、1 high）；本节点没有修改依赖或锁文件，也没有将其描述为已修复。

## 已知限制与下一节点

- 暗色覆盖仍与基础令牌同文件，仅维持现状；主题文件拆分和只覆盖令牌的主题边界属于 2.8。
- `main.css` 仍是当前合并规则文件；reset、shell、layout、component 分层和 `.c-/.l-/.f-/.is-/.has-` 规范属于 2.9。
- Ubuntu Chromium/Tauri 验证不能替代后续涉及原生窗口、文件关联和系统拖放时的 Windows WebView 验证。
- Atomic Task 2.8 只有在本节点三层硬门禁全部通过后才能开始。
