# Stage 2 / Atomic Task 2.8：主题

## 状态

- 当前状态：实现与 GitHub 三层硬门禁全部完成。
- 实施分支：`rewrite/modular-rebuild`。
- 2.7 最终基线：`22859c74c59b6acbc53c2c2af4d56a6416661d18`。
- 实现验证头：`3ea4493155c0567ccd5eb929971bc6d214e7888f`。
- 正式验证：Stage 2 run `31035151976`、Stage 1 run `31035151969`、Stage 0 run `31035151751` 全部通过。
- 下一节点：Atomic Task 2.9 尚未开始。

## 任务边界

本节点只拆分亮暗主题令牌层，并验证切换 `data-theme` 时壳层几何不变化：

1. 亮色和暗色主题只能声明视觉令牌，不得复制组件规则。
2. 主题文件不得拥有字体尺寸、间距、圆角、层级、动效等布局或结构尺度。
3. 保留现有亮暗主题值、主题持久化、设置面板、Mermaid 协调和兼容挂载语义。
4. 删除 `main.css` 中依赖 `data-theme` 的组件选择器，使组件规则只消费令牌。

Atomic Task 2.9 才负责 reset、shell、layout、component 分层及 class 命名规范。本节点没有创建主题服务、迁移主题状态所有权或改变设置行为。

## 实施内容

### 独立主题模块

新增：

- `src/styles/themes/light.css`：默认亮色颜色、基础阴影、代码展示和内容媒体令牌。
- `src/styles/themes/dark.css`：只覆盖亮色文件中已存在的视觉令牌。

`src/styles/index.css` 的加载顺序固定为：

1. `foundation/tokens.css`
2. `themes/light.css`
3. `themes/dark.css`
4. `main.css`

### 令牌职责调整

`src/styles/foundation/tokens.css` 只保留主题无关职责：

- 字体族与字号；
- 间距和圆角尺度；
- 由主题颜色组合出的控件、焦点及卡片阴影；
- 层级；
- 动效。

主题相关的颜色、四个基础阴影和代码展示值迁入亮色主题；暗色主题继续覆盖原有 41 个值。新增 `--content-image-opacity`，以亮色 `1`、暗色 `0.95` 替代原组件级暗色图片规则。

### 组件规则去主题化

- `.preview-content img` 统一消费 `--content-image-opacity`。
- 删除暗色图片组件选择器。
- 删除只重复相同令牌声明的暗色拖放遮罩和菜单栏规则。
- `src/styles/main.css` 不再存在任何 `[data-theme]` 选择器。

### 状态所有权保持不变

- `public/app/bootstrap.js` 继续从 `md_editor_theme` 恢复主题并写入 `document.body[data-theme]`。
- `public/app/core.js` 继续负责主题切换、持久化、Mermaid 主题同步和预览刷新。
- `mount-current-shell.js` 继续只在缺少主题属性时设置默认值，并在销毁时恢复原属性。
- 本节点没有新增主题 store、controller、全局变量或双向同步。

## 契约测试与架构证据

新增 `tests/ui/themes.test.mjs`，锁定：

- 两个主题文件及固定加载顺序；
- 主题文件只能包含自定义属性声明；
- 暗色覆盖必须存在亮色默认值；
- 主题文件禁止布局类令牌；
- 原亮暗视觉值保持不变；
- `main.css` 不得保留 `data-theme` 组件选择器。

`tests/e2e/run-browser-tests.mjs` 新增真实应用布局不变量验证：在同一应用实例内依次切换 light、dark、light，比较 App Shell、菜单、工具栏、工作区、主区域、编辑区、预览区、状态栏和 overlay 的几何及文档尺寸，同时确认视觉令牌发生变化且恢复可逆。

机器可读生产模块记录由 89 增至 91，新增两个 `presentation-theme` 模块。Stage 2 工作流新增 2.8 专项、`02-08-theme-evidence.json` 以及构建后应用主题回归；证据生成逻辑提取到 `scripts/stage-02/record-ui-foundation-evidence.mjs`，工作流只负责步骤编排。

## 接口、行为与兼容性

- `data-theme` 属性位置、允许值和写入语义保持不变。
- localStorage key、设置字段、主题按钮、Mermaid 主题及预览刷新行为保持不变。
- DOM、选择器、App Shell refs、Modal Shell、业务全局和持久化格式保持不变。
- 默认 157 个令牌值和原有 41 个暗色覆盖值逐项保持一致。
- 未修改 Rust、Tauri 配置、依赖、锁文件、环境变量、冻结模型或数据格式。

## 验证结果

### 本地与受控实现验证

- `node --test tests/ui/css-tokens.test.mjs tests/ui/themes.test.mjs`：6/6 通过。
- 2.1–2.8 专项合并验证：30/30 通过。
- 原 157 个默认令牌与 41 个暗色覆盖逐项值对照：完全一致；新增项仅为 `--content-image-opacity`。
- 修改的 JavaScript 与测试文件 `node --check`：通过。
- `.github/workflows/stage-02-atomic.yml`：YAML 解析通过；`scripts/stage-02/record-ui-foundation-evidence.mjs` 语法及实际证据生成通过。
- `node --test tests/browser-e2e-contract.test.mjs`：5/5 通过，并锁定主题几何不变量场景存在。
- `verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record`、`git diff --check`：通过。
- 受控 Runner 完成 30/30 阶段专项、36/36 Node、9/9 浏览器契约、生产构建和 11/11 构建后浏览器验证。
- 本地 `npm ci` 被内部 npm 镜像缺少 `w3c-keyname@2.2.8` 阻塞；未修改依赖或锁文件绕过，完整依赖验证由 GitHub Runner 完成。

### GitHub 正式三层验证

实现验证头 `3ea4493155c0567ccd5eb929971bc6d214e7888f`：

- Stage 2 run `31035151976`：通过 2.1–2.8 专项、架构硬门禁、证据生成、36/36 Node、9/9 浏览器契约、生产构建及 11/11 构建后主题布局不变量验证。
- Stage 1 run `31035151969`：通过架构基础、生产模块清单、完整 Node、浏览器契约和生产构建回归。
- Stage 0 run `31035151751`：通过静态基线、完整 Node、浏览器契约、生产构建、构建后浏览器、Rust test/check、Tauri Linux 扩展构建及最终硬门禁。
- `npm ci` 报告既有 2 项依赖审计问题：1 low、1 high；本任务未新增或升级依赖，也未执行自动依赖修复。

## 已知限制与下一节点

- 主题状态仍由兼容经典脚本拥有；正式主题服务迁移属于后续对应 Feature 阶段，不在本节点提前实施。
- `main.css` 仍是合并规则文件；reset、shell、layout、component 分层和 `.c-/.l-/.f-/.is-/.has-` 规范属于 2.9。
- Ubuntu Chromium/Tauri 验证不能替代后续涉及原生窗口、文件关联和系统拖放时的 Windows WebView 验证。
- Atomic Task 2.9 只有在本节点三层硬门禁全部通过后才能开始。
