# 阶段 1 / Atomic Task 1.7：模型稳定入口

## 节点状态

- 结果：**通过**
- 阶段状态：阶段 1 继续进行；Atomic Task 1.7 已完成，Atomic Task 1.8 尚未开始。
- 工作分支：`rewrite/modular-rebuild`
- 实现提交：`71c2319dfa45f653adac028de28f007c9347208e`
- 完整调用链修复提交：`a29b469d7be72440c684a76c100132d8e5dd86e3`
- 阶段 1 专项验证：GitHub Actions run `30964745475`
- 专项证据工件：`stage-01-architecture-foundation-30964745475-1`
- 专项证据工件 ID：`8914288408`
- 专项证据摘要：`sha256:4378333cba4ff745f85f7b7712f912c4ac0a465144ced56ea49d285c288cf8b0`
- 完整基线回归：GitHub Actions run `30964745509`
- 完整基线工件：`stage-00-baseline-30964745509-1`
- 完整基线工件 ID：`8914443095`
- 完整基线摘要：`sha256:ce047e7fad89aa71aca5d59c3419dc7a040554ec81a9899b40d3891388d1ccb0`
- 上一节点基线：`0c10c7254163df8eba55d87ef350240c04caaf90`

## 实际目标

为阶段 0 已冻结的模型与数据契约建立唯一、稳定、只读的 JavaScript 公共入口，使非模型生产模块不再依赖冻结实现文件的物理路径。入口只承担显式命名重导出，不拥有状态、不执行初始化、不转换参数、不包装返回值，也不建立第二份模型实现。

本节点不执行以下工作：

- 不修改任何冻结模型或持久化文件正文；
- 不重写、优化或重新解释模型算法；
- 不改变导出对象、函数签名、参数语义或返回值；
- 不新增业务能力、状态容器、兼容层或生产依赖；
- 不执行阶段 1.8 的通用架构扫描脚本；
- 不切换应用组合根或移除旧经典脚本。

## 新增稳定入口

### `src/model-kernel/index.js`

该文件是冻结 JavaScript 模型能力的唯一公共入口，使用 8 组显式命名重导出公开 26 个既有符号：

- 文档模型：`DocumentModel`、`createDocumentModel`；
- 增量预览：`IncrementalPreviewModel`；
- 表格模型：`encodeTableCell`、`parseTableRow`；
- 数学范围：`collectInlineMathRanges`、`collectMathBlocks`；
- 混合编辑范围：`collectVisibleLines`、`getEditableRanges`、`getExpandedVisibleRanges`、`intersectsRanges`、`intersectsRevealRanges`、`mergeRanges`、`overlapsRanges`、`shouldDecorateSourceActiveLine`；
- 选区映射：`createMarkdownSourceProjection`、`createPreviewDomProjection`、`createPreviewRangesForSourceSelection`、`getSelectionMappingDiagnostics`、`mapPreviewDomPointToSource`、`selectionMappingApi`；
- 数学源码：`collectBackslashDisplayMathRanges`、`containsMarkdownMath`、`protectMarkdownMathSource`、`restoreMarkdownMathSource`；
- 混合块识别：`collectHybridBlocks`。

入口明确禁止 `export *`，避免冻结实现后续出现新导出时静默扩大公共契约。文件中没有导入绑定、变量、函数、类、初始化语句或平台访问，因此导入本身不产生额外副作用。

## 调用链切换

下列非模型生产模块已改为只通过 `src/model-kernel/index.js` 使用冻结能力：

- `src/main.js`：文档模型、增量预览模型、选区映射 API；
- `src/editor/hybrid/controller.js`：混合块识别和可编辑范围；
- `src/editor/hybrid/inline-presentation.js`：数学范围和混合范围规则；
- `src/editor/hybrid/widgets.js`：表格单元格安全序列化；
- `src/preview/preview-worker.js`：增量预览模型和数学源码保护/恢复；
- `src/rendering/math-presentation.js`：数学源码检测、保护和恢复。

冻结模块内部仍可按其既有内部依赖关系直接引用其他冻结实现；架构门禁只禁止非模型生产模块绕过公共入口。这样保持冻结实现内部引用和算法正文完全不变，同时为后续迁移提供稳定依赖边界。

## 契约门禁

新增 `tests/architecture/model-kernel-contract.test.mjs`，覆盖以下不可回退约束：

1. 公共入口必须精确导出 26 个既有符号；
2. 每个导出必须与原冻结模块保持严格引用身份，不允许包装或复制；
3. 25 个可调用导出的函数 `length` 必须保持既有参数个数；
4. `selectionMappingApi` 必须保持原引用且继续冻结；
5. 入口必须由 8 条显式命名重导出语句组成；
6. 禁止 `export *`、变量、函数、类和初始化语句；
7. 阶段 0 记录的 9 个冻结文件 SHA-256 必须逐项一致；
8. 扫描全部 `src/**/*.js`，非模型模块直接导入冻结实现时输出精确违规路径并失败。

`.github/workflows/stage-01-atomic.yml` 已接入该测试，并生成 `artifacts/stage-01/01-07-model-kernel.json` 结构化证据。生产模块职责清单新增稳定入口，文件总数由 66 增至 67。

## 首次专项失败与修复

首次专项 run `30964679899` 在新硬门禁处停止。测试准确报告：

```text
src/rendering/math-presentation.js -> src/preview/math-source.js
```

该调用者最初扫描时遗漏，说明门禁能够发现非模型模块对冻结实现的残余直连。随后仅将该模块的数学源码导入切换到稳定入口，形成提交 `a29b469d7be72440c684a76c100132d8e5dd86e3`。失败后未继续运行后续回归；修复后的专项 run `30964745475` 才继续完成完整阶段验证。

## 阶段 1 专项验证

GitHub Actions run `30964745475`：**通过**。

- 67 文件生产模块清单：通过；
- 最小组合根：通过；
- 应用生命周期状态机：通过；
- 资源销毁注册表：通过；
- 命令基础设施：通过；
- 事件基础设施：通过；
- 模型稳定入口四组契约测试：通过；
- 现有 Node 回归：通过；
- Chromium 交互契约：通过；
- 前端生产构建：通过；
- 阶段 1 结构化证据上传：通过。

结构化证据记录：

- 冻结 JavaScript 模块：8；
- 冻结契约文件总数：9；
- 公共导出：26；
- 导出策略：`explicit-named-reexports`；
- 调用者策略：`non-model-through-facade`；
- 冻结哈希：`unchanged`。

## 完整基线回归

GitHub Actions run `30964745509`：**通过**。

- Node 回归测试：通过；
- Chromium 交互契约：通过；
- 前端生产构建：通过；
- 构建后应用级浏览器回归 7/7：通过；
- `cargo test --locked`：通过；
- `cargo check --locked`：通过；
- Tauri Linux release build：通过；
- 阶段 0 硬门禁：通过。

## 行为与兼容性

- 9 个冻结模型和数据契约文件正文及 SHA-256 保持不变；
- 26 个 JavaScript 公共符号保持名称、引用身份、函数参数个数和调用语义；
- 文档、预览、混合编辑、数学展示和选区映射的用户可观察行为保持不变；
- 公共接口、持久化格式、配置、默认值、错误语义、权限和兼容路径未改变；
- 未新增生产依赖；
- 未保留重复模型实现、转发包装器或版本后缀文件。

## 验证限制

- 当前执行容器无法直接解析 `github.com` 并建立本地 clone，实施通过 GitHub connector 原子提交，验证通过 GitHub-hosted Actions 完成；
- 完整桌面回归运行在 Ubuntu 22.04，Windows 原生窗口、文件关联和系统拖放未在本节点直接验证；
- 本节点只建立模型公共入口和专项门禁，跨 Feature 的通用架构扫描属于 Atomic Task 1.8。

## 节点结论

Atomic Task 1.7 已完成并通过专项验证与完整基线回归。冻结模型能力现在只有一个显式、无副作用、可锁定的公共入口；所有已确认非模型调用者均已切换，冻结正文、模型身份、签名、持久化和用户行为保持不变。下一节点为 Atomic Task 1.8：架构脚本。
