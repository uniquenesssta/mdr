# 阶段 1 / Atomic Task 1.8：架构脚本

## 节点状态

- 结果：**通过**
- 阶段状态：阶段 1 继续进行；Atomic Task 1.8 已完成，Atomic Task 1.9 尚未开始。
- 工作分支：`rewrite/modular-rebuild`
- 实现提交：`e0b56954c345a5574013e6507881d00df5a62782`
- 阶段 1 专项验证：GitHub Actions run `30970380961`
- 专项证据工件：`stage-01-architecture-foundation-30970380961-1`
- 专项证据工件 ID：`8916277394`
- 专项证据摘要：`sha256:ff90e549a7ff71a6873532a94f4d407ee3cf7d658b4d18442eae9664e703a93d`
- 完整基线回归：GitHub Actions run `30970380963`
- 完整基线工件：`stage-00-baseline-30970380963-1`
- 完整基线工件 ID：`8916399298`
- 完整基线摘要：`sha256:28b424bfd81ea74a0aea24f87fd845a131cf066cbd86312343306e355ac86ffe`
- 上一节点基线：`d4c27cc735da578e6269ec8d362d8f8e8acc6cf8`

## 实际目标

为模块化重写建立可执行、可复现、失败即阻断的架构扫描层。该层负责发现并精确报告：

- 新增或变化的内联事件；
- 新增经典脚本和未经分类的经典脚本加载；
- 新增或变化的业务全局写入；
- Feature 反向依赖应用组合根；
- 跨 Feature 内部路径导入；
- Platform 反向导入 Feature；
- Model Kernel 导入高层模块；
- JavaScript 模块循环依赖；
- 严格架构模块导入阶段访问 DOM、Storage、Worker、计时器、网络或 Tauri 运行时；
- 新增被 Git 跟踪的构建、缓存或运行产物；
- `old`、`new`、`v2`、`final`、`copy` 等旧文件后缀；
- README 阶段记录缺失、重复、顺序错误或结构错误。

本节点只建立扫描器、精确迁移基线、契约测试和 CI 硬门禁，不迁移现有经典脚本、内联事件或业务全局，不修改任何生产功能。`package.json` 中的统一命令入口属于 Atomic Task 1.9，本节点未提前实施。

## 新增脚本结构

### `scripts/architecture/repository.mjs`

统一负责仓库文件发现、Git 跟踪文件读取、路径规范化、生产模块清单加载、精确基线加载、相对模块解析和行列定位。Git 可用时以 `git ls-files` 为准；测试夹具中无完整 Git 环境时才退回受控目录遍历。

### `scripts/architecture/source-analysis.mjs`

只负责源码事实提取：

- 静态 import、re-export 和字面量 dynamic import；
- HTML 内联事件；
- HTML 和现有动态加载器中的经典脚本；
- `window` / `globalThis` 业务全局写入；
- Feature 名称和公共入口识别。

该模块不决定违规策略，避免把解析、基线和架构规则堆积在单一入口中。

### `scripts/architecture/checks.mjs`

集中实现架构规则，但不处理命令行展示。主要检查包括：

1. 精确迁移基线对比；
2. 经典脚本分类；
3. 严格架构目录业务全局禁止；
4. 跟踪生成文件和旧后缀；
5. 依赖方向与循环依赖；
6. 隔离子进程导入副作用探测；
7. README 与阶段详细记录的一致性。

### `scripts/architecture/cli.mjs`

统一参数、JSON 证据输出、终端错误格式和退出码。任何违规或脚本异常都会设置非零退出码；错误行包含规则名、精确仓库路径以及可取得时的行列位置。

### 公共执行入口

新增四个职责单一的入口：

- `scripts/verify-architecture.mjs`：执行全部架构规则；
- `scripts/verify-no-legacy-runtime.mjs`：执行经典脚本、内联事件和业务全局回归门禁；
- `scripts/verify-generated-files.mjs`：执行生成文件和旧后缀门禁；
- `scripts/verify-readme-record.mjs`：执行 README 阶段记录一致性门禁。

入口只负责选择检查集合和调用统一 CLI，不重复实现扫描逻辑。

## 精确迁移基线

新增 `tests/architecture/fixtures/architecture-baseline.json`，类型为：

```text
stage-01-exact-migration-regression-baseline
```

基线逐项记录阶段 1.8 开始时仍存在、后续阶段需要移除的旧运行时事实：

- 经典脚本：9；
- 内联事件：184；
- 业务全局写入：38；
- 已被 Git 跟踪的缓存或运行产物：4。

基线具有以下约束：

- 不接受通配符豁免；
- 路径、事件属性、处理器文本、全局名称和出现次数均精确记录；
- 新增、删除、改名或出现次数变化都会失败；
- 后续迁移删除旧实现时，必须在同一受审变更中同步缩减基线；
- 基线不能被用来允许新增旧实现。

该设计没有把当前遗留问题宣称为合规目标，而是把现状转化为只减不增、每次变化都必须显式审查的迁移回归边界。

## 依赖边界与循环检测

依赖图以 `tests/architecture/fixtures/production-modules.json` 中的生产 JavaScript 模块为节点，解析相对 import、re-export 和字面量 dynamic import。

当前门禁强制：

- `src/features/<feature>/` 不得导入 `src/app/` 内部；
- 跨 Feature 只能依赖目标 Feature 的 `index.js`；
- `src/platform/` 不得导入 `src/features/`；
- `src/model-kernel/` 不得导入 `src/app/`、`src/platform/`、`src/features/` 或 `src/ui/`；
- 全部已识别生产 JavaScript 模块不得形成循环依赖。

循环错误输出完整闭环路径，例如：

```text
module-a.js -> module-b.js -> module-a.js
```

## 模块导入副作用

以下严格架构目录中的 JavaScript 模块会在独立 Node 子进程中逐个导入：

- `src/app/`；
- `src/model-kernel/`；
- `src/features/`；
- `src/platform/`；
- `src/ui/`；
- `src/i18n/`。

探测进程将 DOM、Window、Storage、Worker、Observer 和 Tauri 运行时设置为不可用，并将计时器、事件注册、动画调度和网络调用替换为立即失败的探针。模块必须在导入阶段保持无运行时访问；实际运行行为只能通过显式 `start()`、工厂或实例方法发生。

现有旧运行时模块没有被错误标记为新架构模块；它们由精确迁移基线负责只减不增。

## 契约测试

新增以下测试：

- `tests/architecture/dependency-boundaries.test.mjs`；
- `tests/architecture/no-global-business-api.test.mjs`；
- `tests/architecture/no-inline-events.test.mjs`；
- `tests/architecture/module-side-effects.test.mjs`；
- `tests/architecture/architecture-tooling.test.mjs`；
- `tests/architecture/helpers.mjs` 仅提供隔离临时仓库构建能力。

共 10 个测试用例覆盖：

- 合法公共 Feature 入口；
- 跨 Feature 内部导入；
- 循环依赖；
- 精确业务全局基线；
- 严格目录业务全局禁止；
- 内联事件新增；
- 经典脚本新增；
- 导入阶段计时器副作用；
- 新跟踪生成文件和旧后缀；
- README 阶段记录缺失。

测试不仅断言“失败”，还断言规则名、精确路径、行号或错误内容。命令行失败测试确认脚本返回非零退出码并把违规路径打印到标准错误。

## CI 接入

`.github/workflows/stage-01-atomic.yml` 已新增：

1. 架构扫描器契约测试；
2. `verify-architecture` 硬门禁；
3. `01-08-architecture-scan.json` 原始扫描证据；
4. `01-08-architecture-gates.json` 汇总证据。

Stage 1 工作流不再仅通过局部路径过滤触发，而是在针对 `main` 的 PR 打开、同步或重开时执行，使新增未知文件、跨层依赖或生成产物不能通过未被列入路径过滤器来绕过架构门禁。

机器证据记录九类门禁、精确基线数量、基线来源提交和 `wildcardExemptions: false`。

## 基线生成过程与已修复问题

为避免人工复制 184 个内联事件记录，先通过只读临时工作流在 GitHub-hosted runner 上生成基线工件。只读 run `30970094769` 通过，并确认扫描数量。

首次自动提交基线 run `30970165781` 失败。原因不是扫描或数量不匹配，而是提交脚本使用 `git diff --name-only` 检查尚未暂存的新文件；Git 不会在该命令中列出未跟踪文件。失败后没有推送任何基线或其他文件。

随后改为：

1. 先暂存唯一基线文件；
2. 使用 `git diff --cached --check`；
3. 精确断言暂存文件列表；
4. 再提交和推送。

修复后的 run `30970212711` 通过并提交基线。临时工作流随后删除，仓库未遗留可写自动提交路径。

## 阶段 1 专项验证

GitHub Actions run `30970380961`：**通过**。

- 既有阶段 1.1–1.7 契约：通过；
- 新增架构扫描器 10 个契约测试：通过；
- 全仓架构硬门禁：通过，违规数 0；
- 生产模块清单：通过，仍为 67 个生产模块；
- 既有 Node 回归：通过；
- Chromium 交互契约：通过；
- 前端生产构建：通过；
- 阶段 1 结构化证据上传：通过。

`01-08-architecture-gates.json` 记录：

- `status: passed`；
- 九类架构门禁；
- `wildcardExemptions: false`；
- 经典脚本 9；
- 内联事件 184；
- 业务全局 38；
- 跟踪生成文件 4。

## 完整基线回归

GitHub Actions run `30970380963`：**通过**。

- Node 回归测试：通过；
- Chromium 交互契约：通过；
- 前端生产构建：通过；
- 构建后应用级浏览器回归：通过；
- `cargo test --locked`：通过；
- `cargo check --locked`：通过；
- Tauri Linux release build：通过；
- 阶段 0 硬门禁：通过。

## 行为与兼容性

- 未修改 `src/`、`public/`、`index.html` 或 `src-tauri/` 的生产实现；
- 生产模块数量保持 67；
- 9 个冻结模型和数据契约文件未修改；
- 公共接口、持久化格式、配置、默认值、错误语义和用户可观察行为未改变；
- 未新增生产或开发依赖；
- 未修改 `package.json`，统一 package script 入口保留给 Atomic Task 1.9；
- 未删除当前经典脚本、内联事件或业务全局；这些迁移属于后续功能重写阶段。

## 验证限制

- 依赖扫描只分析生产清单中的相对、字面量 JavaScript 模块引用；运行时计算得到的模块路径不作为合法跨层依赖方式，后续若出现必须增加明确扫描规则或禁止规则；
- 模块副作用探测针对目标模块化目录的外部运行时访问，不禁止纯模块内部常量、冻结对象和无外部可观察状态初始化；
- 完整桌面回归运行在 Ubuntu 22.04，Windows 原生窗口、文件关联和系统拖放未在本节点直接验证；
- 当前精确基线记录的是待迁移旧事实，不代表允许长期保留；后续移除时必须同步缩减基线。

## 节点结论

Atomic Task 1.8 已完成。仓库现在具备独立、模块化、可测试的架构扫描层；违规会返回非零退出码并打印精确路径。当前遗留运行时被精确锁定为只减不增，目标架构目录则立即执行严格依赖和无导入副作用规则。下一节点为 Atomic Task 1.9：package scripts。
