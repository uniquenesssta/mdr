# 阶段 1 / Atomic Task 1.1：基线与模块清单

## 节点状态

- 结果：**通过**
- 阶段状态：阶段 1 已开始，Atomic Task 1.1 已完成；Atomic Task 1.2 尚未开始。
- 工作分支：`rewrite/modular-rebuild`
- 实现提交：`b0f0f98cf087d22f2a4894cdab8aa065cf543b01`
- 阶段 1 专项验证：GitHub Actions run `30904310568`
- 专项证据工件：`stage-01-01-01-module-inventory-30904310568-1`
- 完整基线回归：GitHub Actions run `30904310598`
- 原始业务源码基线：`main@8ec8bf4ed58e6fd1c5c91466569a56ba247b6a62`
- 阶段 0 完成基线：`f714feb73338ae049abf53907ff6469c887e1f6b`

## 实际目标

在建立最小组合根之前，为当前全部生产 JS、Rust、CSS 与 HTML 文件建立可机器验证的职责边界，明确每个文件的：

- 技术表面与所属层；
- 单一主要职责；
- 状态权威所有者；
- 生命周期；
- 后续迁移处置；
- 是否属于冻结模型范围；
- 实际导入、导出、事件监听、全局写入与副作用信号。

本节点只建立架构事实基线和门禁，不迁移业务功能、不改变 UI、不删除 `public/app/`，也不修改冻结模型正文。

## 新增文件

### 机器可读职责清单

- `tests/architecture/fixtures/production-modules.json`
  - 使用紧凑字段模式保存生产模块职责，避免维护第二份散乱说明。
  - 字段为 `path`、`surface`、`layer`、`responsibility`、`stateOwner`、`lifecycle`、`migration`、`frozen`。
  - 当前精确覆盖 57 个生产文件。

### 清单采集器

- `scripts/stage-01/module-inventory-core.mjs`
  - 负责生产文件发现、紧凑清单标准化、源码信号分析和最终库存构建。
  - JavaScript 扫描静态/动态导入、导出、DOM 监听器、`window/globalThis` 写入、DOM/Storage/网络/计时器/Observer/Worker/Tauri 命令信号。
  - Rust 扫描 `use/mod`、公开导出、静态状态、Tauri command、文件系统、网络、进程与同步原语信号。
  - HTML 扫描模块脚本、经典脚本与内联事件属性。
  - CSS 扫描 `@import`、规则数量与自定义属性。
  - 为每个文件记录字节数、行数与 SHA-256。
- `scripts/stage-01/collect-module-inventory.mjs`
  - 提供独立 CLI，将检测结果写入结构化 JSON 工件。

### 架构测试与 CI

- `tests/architecture/module-inventory.test.mjs`
  - 验证职责清单与实际生产文件集合完全一致，不允许漏项、重复项或多余项。
  - 验证职责、状态所有者、生命周期、表面类型和迁移处置字段完整。
  - 验证 9 个冻结文件与阶段 0 冻结哈希清单路径完全一致。
  - 验证采集器真实输出导入、导出、监听器、全局写入、副作用及 SHA-256。
  - 保留对当前经典脚本和 `src/main.js` 全局桥接现状的显式识别，避免后续迁移时遗漏。
- `.github/workflows/stage-01-atomic.yml`
  - 独立执行清单门禁、结构化工件生成、现有 Node 回归、浏览器交互契约与生产构建。
  - 不修改仓库，不自动推送验证结果。

## 当前架构事实

结构化工件确认：

- 生产文件总数：57。
- 冻结模型/数据契约文件：9。
- 经典脚本：9，其中 `public/app/*.js` 8 个、`public/i18n.js` 1 个。
- ESM 普通模块：34；ESM facade：2；ESM entrypoint：1；ESM worker：1。
- Rust 运行模块：5；Rust entrypoint：1；Rust build script：1。
- HTML shell、主样式表、Vite 配置各 1 个。
- 检测到全局或静态写入信号的文件：13。
- 检测到事件监听信号的文件：17。

迁移处置统计：

- `rewrite`：25。
- `split-and-remove`：7。
- `decompose`：7。
- `retain-frozen`：8。
- `decompose-preserving-contract`：1，即 `src-tauri/src/document_store.rs`。
- 其余文件按 `retain`、`rewrite-and-remove`、`remove-after-migration`、`rewrite-facade`、`replace-with-composition-root`、`retain-until-final-switch` 或 `split-by-feature` 分类。

上述处置是后续任务的边界输入，不代表本节点已经迁移、拆分或删除对应实现。

## 冻结边界

本节点没有修改下列冻结文件正文：

- `src/document/document-model.js`
- `src/preview/incremental-preview.js`
- `src/editor/hybrid/table-model.js`
- `src/editor/hybrid/math-ranges.js`
- `src/editor/hybrid/ranges.js`
- `src/sync/selection-mapping.js`
- `src/preview/math-source.js`
- `src/editor/hybrid/block-registry.js`
- `src-tauri/src/document_store.rs`

清单测试只对照阶段 0 冻结哈希证据验证路径集合；没有重新定义或放宽模型契约。

## 验证过程

### 首轮失败与修复

Stage 1 专项 run `30904172307` 在第三项清单测试中失败。前两项已证明文件覆盖和冻结分类正确；失败原因为测试先展开紧凑清单，又把展开后的对象重复传给只接受紧凑格式的标准化入口，报错：

```text
Invalid compact module record at index 0.
```

处理方式：

- 只修正测试调用边界，使采集器接收原始紧凑清单。
- 保持采集器输入校验严格；没有为错误输入增加静默兼容。
- 失败后未执行后续回归，也未推进 Atomic Task 1.2。

修复提交：`b0f0f98cf087d22f2a4894cdab8aa065cf543b01`。

### 专项验证结果

GitHub Actions run `30904310568`：**通过**。

- `npm ci`：通过。
- `node --test tests/architecture/module-inventory.test.mjs`：3/3 通过。
- `node scripts/stage-01/collect-module-inventory.mjs`：成功生成 57 模块结构化工件。
- `npm test`：通过。
- `npm run test:browser:contract`：通过。
- `npm run build`：通过。
- 证据工件上传：通过。

### 完整基线回归

GitHub Actions run `30904310598`：**通过**。

- Rust 1.88.0 工具链与 Tauri Linux 系统依赖：通过。
- 静态基线、契约与冻结哈希采集：通过。
- Node 测试、浏览器交互契约与前端生产构建：通过。
- 应用级浏览器回归：7/7 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`：通过。
- `cargo check --manifest-path src-tauri/Cargo.toml --locked`：通过。
- Tauri Linux release build：通过。
- 阶段 0 硬门禁复验：通过。

## 行为与兼容性

- 未修改任何生产 JS、Rust、CSS 或 HTML 文件。
- 未修改公共接口、调用语义、配置默认值、持久化结构、数据格式、错误语义或用户可观察行为。
- 未新增生产依赖。
- 未删除、跳过或放宽既有测试。
- 现有应用仍保持阶段 0 通过状态。

## 已知限制

- 当前完整回归运行在 Ubuntu 22.04；Windows 原生窗口、文件关联和桌面拖放仍不属于本节点验证范围。
- 清单检测使用有界静态信号扫描，不能取代后续任务对动态调用链和状态流的逐模块审计。
- `window/globalThis`、监听器和副作用计数是迁移风险信号，不代表每一项都是缺陷。
- 本地容器无法解析 `github.com`，因此无法执行本地 checkout 和 `git status --short --branch`；远端分支状态通过 GitHub PR/head 校验，所有可执行验证均在 GitHub-hosted runner 完成。

## 节点结论

Atomic Task 1.1 已完成并通过独立验证与完整回归。后续 Atomic Task 1.2 可以依赖该机器可读清单建立最小组合根，但本节点没有开始 1.2。
