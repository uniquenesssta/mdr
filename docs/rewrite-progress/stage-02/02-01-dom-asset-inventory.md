# 阶段 2 / Atomic Task 2.1：DOM 资产盘点

## 节点状态

- 结果：**通过**
- 阶段状态：**阶段 2 已开始；Atomic Task 2.1 已完成；Atomic Task 2.2 尚未开始。**
- 工作分支：`rewrite/modular-rebuild`
- 上一阶段最终基线：`c1ef5c7de6428f0be5ceb39438f1156c177528ce`
- 2.1 正式实现提交：`45bcecc5bb504a4da5a68f01ad1d137fac8e89e4`
- 永久 Stage 2 CI 与临时文件清理后主实现头：`8d0d849d6a91bf9c5ac4e2fa9d75e0bef76c573b`
- Stage 2 专项验证：GitHub Actions run `30992035044`
- 专项工件：`stage-02-ui-foundation-30992035044-1`
- 专项工件 ID：`8924534110`
- 专项工件摘要：`sha256:2a07df17352537d723a733c0f3d3af6e1bf0febb93afeda7270cb7315c86b36b`
- 完整基线回归：GitHub Actions run `30992034408`
- 完整基线工件：`stage-00-baseline-30992034408-1`
- 完整基线工件 ID：`8924757459`
- 完整基线摘要：`sha256:a8ce7c5dfea24e42964e81d45de8758e0373f893825d7402a1a11914de181a06`

## 实际目标

Atomic Task 2.1 只建立旧 UI DOM 的机器可读盘点和迁移责任映射，为 2.2 及后续 UI 壳重写提供可验证基线。

本节点必须回答：

1. 旧 `index.html` 中有哪些真实节点；
2. 每个节点属于哪个语义区域；
3. 每个节点当前承载哪些 ID、class、ARIA、内联事件、内联样式和 `data-*` 属性；
4. 生产 JavaScript 如何通过选择器或 ID 使用这些节点；
5. 测试如何依赖这些选择器；
6. JavaScript 如何动态增加、移除、切换或替换 class；
7. 每个旧节点在后续任务中由谁接管以及采用什么迁移处置；
8. 是否存在没有迁移归属或同时匹配多个归属的节点。

## 明确不属于本节点的内容

本节点没有：

- 重写 `index.html`；
- 删除任何旧节点；
- 创建新的 App Shell；
- 抽取 SVG 图标文件；
- 创建 Modal Shell；
- 拆分或重写 CSS；
- 移除内联事件；
- 移除经典脚本；
- 切换 `src/main.js` 或生产启动链；
- 迁移任何业务 Feature；
- 修改依赖、锁文件、配置、持久化或冻结模型。

因此，2.1 完成不表示 UI 壳已经迁移，也不表示旧 DOM 可以删除。

## 旧 DOM 精确基线

盘点源文件：`index.html`

- 基线提交：`c1ef5c7de6428f0be5ceb39438f1156c177528ce`
- SHA-256：`a52065b680f26f3169193f6c937753f83eed25f882712e8955ccbe3b075fd29f`
- JavaScript 行切分计数：944 行，包括文件末尾空行
- HTML 元素：1054 个
- 唯一 ID：173 个
- 唯一静态 class：140 个
- 内联事件：184 个
- 内联样式节点：32 个
- 带 ARIA 或 `role` 的节点：72 个
- 带 `data-*` 属性的节点：163 个
- script 节点：2 个
- stylesheet link：0 个
- 扫描的仓库文本文件：83 个
- 生产选择器调用：351 个
- 测试选择器调用：45 个
- class 变更调用：225 个
- 动态 class 字面量：122 个
- 语义区域：31 个

脚本入口仍为：

1. 经典脚本 `/i18n.js`；
2. 模块入口 `/src/main.js`。

这些事实与阶段 1 精确遗留基线一致，本节点没有缩减遗留数量。

## 语义区域与后续归属

### 2.2 最小 `index.html`

- `document-shell`：文档元信息及根容器，6 个节点；保留为最小 HTML 壳。
- `legacy-i18n-script`：经典 i18n 脚本，1 个节点；仅在模块入口替代完成后移除。
- `module-entry-script`：当前模块入口，1 个节点；后续保留为最小模块入口。

### 2.3 SVG Sprite

- `icon-sprite`：内联 SVG symbol sprite，130 个节点；目标为 `public/assets/icons.svg`。

### 2.4 App Shell

- `application-shell-root`：应用根容器，1 个节点。
- `menu-bar`：品牌、菜单和窗口控制，172 个节点。
- `toolbar-shell`：格式工具栏与编辑动作，143 个节点。
- `workspace-shell`：工作区布局容器，1 个节点。
- `sidebar-shell`：侧栏标签与面板，34 个节点。
- `sidebar-resizer`：侧栏分隔拖动条，1 个节点。
- `workspace-main`：编辑器和预览分栏容器，1 个节点。
- `editor-slot`：编辑器面板及挂载点，9 个节点。
- `workspace-resizer`：编辑器与预览分隔拖动条，1 个节点。
- `preview-slot`：预览面板及来源挂载点，10 个节点。
- `status-bar`：状态栏，9 个节点。
- `drop-overlay`：拖放覆盖层，5 个节点。
- `toast`：Toast 容器，1 个节点。

目标职责进一步拆分到：

- `src/ui/shell/app-shell-view.js`
- `src/ui/shell/menu-bar-shell.js`
- `src/ui/shell/toolbar-shell.js`
- `src/ui/shell/workspace-shell.js`
- `src/ui/shell/sidebar-shell.js`
- `src/ui/shell/status-bar-shell.js`
- `src/ui/shell/overlay-root.js`

这些目标文件只是迁移映射，不代表 2.1 已创建对应生产实现。

### 2.5 DOM Primitives

- `document-context-menu`：文档上下文菜单，9 个节点。
- `sidebar-context-menu`：侧栏上下文菜单，5 个节点。
- `outline-context-menu`：大纲上下文菜单，5 个节点。

菜单内容由对应 Feature 拥有，通用显示、隐藏和定位能力由作用域 DOM primitives 提供。

### 2.6 Modal Shell

- `settings-modal`：177 个节点。
- `help-modal`：165 个节点。
- `link-modal`：16 个节点。
- `url-modal`：25 个节点。
- `find-modal`：21 个节点。
- `export-progress-modal`：11 个节点。
- `export-image-modal`：39 个节点。
- `image-modal`：30 个节点。
- `mermaid-modal`：21 个节点。

通用模态框生命周期目标为 `src/ui/components/modal-shell.js`，业务内容仍归各自 Feature 所有。

### 后续 Feature 迁移

- `file-input-ports`：2 个隐藏文件输入节点；改为 Feature 显式端口。
- `export-image-stage`：2 个离屏导出渲染节点；改为导出 Feature 拥有的渲染端口。

## 迁移覆盖结论

`tests/ui/fixtures/dom-migration-map.json` 的覆盖结果：

- `nodeCount`：1054
- `assignedNodeCount`：1054
- `unassignedNodeCount`：0
- `ambiguousNodeCount`：0

每个旧 HTML 元素具有：

- 唯一稳定路径；
- 唯一语义区域；
- 当前所有者；
- 目标所有者；
- 目标 Atomic Task；
- 唯一迁移处置。

区域清单同时锁定每个区域的预期节点数量。任何旧 HTML 结构增删、区域根路径变化、目标归属变化或节点数量漂移都会使契约测试失败。

## 实际实现

### `scripts/stage-02/dom-inventory/html-inventory.mjs`

职责：

- 解析旧 HTML；
- 生成稳定树路径；
- 记录父子层级、起止行和闭合情况；
- 记录标签、ID、class、ARIA、`data-*`、内联事件、内联样式和完整属性；
- 收集 script 入口；
- 生成源文件摘要。

该模块不扫描仓库引用，也不决定迁移归属。

### `scripts/stage-02/dom-inventory/repository-references.mjs`

职责：

- 扫描生产和测试文本文件；
- 采集 `getElementById`、`querySelector`、`querySelectorAll`、`closest` 和 `matches` 等选择器证据；
- 区分生产选择器和测试选择器；
- 采集 `classList.add/remove/toggle/replace`、`className` 和 class `setAttribute` 证据；
- 记录动态 class 字面量和文件行号。

该模块不解析 HTML，也不分配语义区域。

### `scripts/stage-02/dom-inventory/migration-map.mjs`

职责：

- 读取人工审定的区域清单；
- 将每个 HTML 节点分配到唯一语义区域；
- 检查无归属和多重归属；
- 聚合区域的 ID、class、ARIA、事件、样式和引用证据；
- 验证区域预期节点数；
- 输出逐节点迁移表。

该模块不修改任何生产文件。

### `scripts/stage-02/collect-dom-asset-inventory.mjs`

职责：

- 组合三个独立模块；
- 生成盘点证据和迁移映射；
- 支持 CI 工件输出；
- 仅在显式 `--write-fixtures` 时更新仓库夹具。

默认输出：

- `artifacts/stage-02/02-01-dom-asset-inventory.json`
- `artifacts/stage-02/02-01-dom-migration-map.json`

### 机器可读夹具

- `tests/ui/fixtures/dom-region-manifest.json`
- `tests/ui/fixtures/dom-asset-inventory.json`
- `tests/ui/fixtures/dom-migration-map.json`

其中区域清单是人工审定的迁移责任表；另外两个文件由盘点器确定性生成。

### 契约测试

`tests/ui/dom-asset-inventory.test.mjs` 包含三个独立测试：

1. 当前旧 HTML 和仓库引用必须与提交的盘点夹具完全一致；
2. 每个节点必须只有一个语义归属和一个迁移处置；
3. 必须锁定任务书要求的全部资产类别，同时禁止把盘点结果描述成 UI 已迁移。

### Stage 2 CI

`.github/workflows/stage-02-atomic.yml`：

- 验证 Stage 1 交接仍完整；
- 独立执行 2.1 DOM 盘点契约；
- 现场重新生成两个证据文件；
- 使用 `cmp` 验证现场结果与提交夹具逐字节一致；
- 运行架构硬门禁；
- 生成 `02-01-dom-asset-inventory-evidence.json`；
- 运行 Node 回归、浏览器交互契约和生产构建；
- 上传 Stage 2 专项工件。

## 受控实施中的失败与修复

### 初次正式载荷验证失败

第一次受控 bootstrap run `30991456033` 在提交前失败：

- HTML 解析和 1054 个节点的唯一归属均已通过；
- 失败原因是测试按物理内容行理解为 943 行，而 JavaScript `split(/\r?\n/)` 对文件末尾换行产生第 944 个空行条目；
- 修复为锁定扫描器真实、确定性的 944 行计数；
- 失败 run 没有提交或推送任何正式 2.1 文件。

### 首次正式 Stage 2 CI 失败

Stage 2 run `30991936200` 中：

- 2.1 契约通过；
- 两个现场证据与夹具完全一致；
- 架构硬门禁通过；
- 失败仅发生在结构化证据脚本错误读取 `migrationMap.summary`，实际字段为 `migrationMap.coverage`；
- 修复只调整 CI 证据字段，不修改扫描器、夹具、迁移映射或生产代码；
- 修复后的 run `30992035044` 全部通过。

## 验证结果

### Stage 2 专项 run `30992035044`

通过：

- Stage 1 交接契约；
- 2.1 DOM 资产契约 3/3；
- 1054 个节点重新扫描；
- 31 个语义区域重新映射；
- 现场盘点与提交夹具逐字节一致；
- 无归属节点 0；
- 多重归属节点 0；
- 架构硬门禁；
- 结构化证据生成；
- Node 回归；
- 浏览器交互契约；
- 前端生产构建；
- 工件上传。

### 完整 Stage 0 run `30992034408`

通过：

- 静态基线与契约采集；
- Node 测试；
- 浏览器交互契约；
- 前端生产构建；
- 构建后完整应用浏览器回归；
- `cargo test --locked`；
- `cargo check --locked`；
- Tauri Linux release build；
- Stage 0 证据上传；
- 最终硬门禁。

## 保持不变的行为和契约

本节点确认没有改变：

- `index.html` 内容及 SHA-256；
- 生产 CSS；
- 生产 JavaScript；
- Rust 源码；
- 当前 `/i18n.js` 与 `/src/main.js` 启动顺序；
- DOM 结构、ID、class、ARIA、事件和挂载点；
- 用户可观察 UI 和交互；
- 公共接口；
- 数据格式和持久化；
- 配置、默认值和环境变量；
- 错误语义和日志等级；
- 权限与安全边界；
- 冻结模型和数据契约；
- `package.json`、`package-lock.json` 和生产依赖。

生产模块清单仍为 67 个，因为新增内容全部位于 `scripts/`、`tests/` 和 CI。

## 已知限制与剩余风险

- HTML 扫描器面向当前仓库的确定性基线，不是通用浏览器 HTML5 修复树实现；浏览器实际 DOM 行为仍由既有浏览器回归保护。
- 选择器与 class 证据只覆盖可静态识别的字面量调用；运行时拼接值通过逐节点区域映射和现有浏览器回归补充保护。
- 2.1 只冻结迁移责任，没有验证未来 2.2–2.6 的新实现；每个后续节点必须按当前映射逐项消减旧资产并执行真实回归。
- Windows 原生窗口、文件关联和系统拖放不受本节点代码影响，本节点仍未新增 Windows 真实平台验证。
- `npm ci` 继续报告既有 2 个 audit advisory；本节点没有修改依赖或锁文件。

## 下一步边界

Atomic Task 2.2 尚未开始。

2.2 只能依据本节点映射，将 `index.html` 收缩为最小壳并建立模块入口；不得提前实施 2.3 SVG 抽取、2.4 App Shell、2.5 DOM primitives、2.6 Modal Shell 或样式层任务。
