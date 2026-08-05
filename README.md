# Markdown Editor

Markdown Editor 是基于 **Tauri + Rust 后端 + 原生 HTML/CSS/JavaScript 前端** 重构的本地轻量 Markdown 编辑器。

本版本不再以单个 `markdown-editor.html` 作为应用入口，而是采用桌面应用结构：

```text
index.html                  # 前端入口
src/                        # 前端源码
  main.js
  model-kernel/
    index.js                # 冻结 JavaScript 模型能力的稳定显式公共入口
  document/
    document-model.js       # Unified document versions, transaction journal, and explicit snapshots
  editor/
    virtual-editor.js        # CodeMirror 6 虚拟编辑器与旧接口兼容层
    hybrid-markdown.js       # 混合编辑模式对外入口
    hybrid/                  # 块识别、组件、范围状态与行内排版子系统
  rendering/
    presentation-api.js     # 混合模式、实时预览与导出的共享展示 API
    math-presentation.js    # KaTeX 单公式与 DOM 树渲染
    mermaid-presentation.js # Mermaid 加载、主题、缓存与 SVG 归一化
  preview/
    incremental-preview.js   # Markdown 变更窗口与增量块模型
    preview-worker.js        # 后台 Markdown 解析线程
    preview-worker-client.js # 版本化变更事务与过时请求合并
    virtual-preview.js       # 超大文档预览窗口化与高度索引
    enhancement-queue.js     # 数学公式与 Mermaid 的版本化可取消队列
  storage/
    native-document-store.js # CodeMirror 变更事务与 Rust 后台存储协调
  sidebar/
    folder-file-tree.js      # 当前本地文件同目录 Markdown/TXT 文件树
  runtime/
    vendor.js               # marked / KaTeX / Mermaid / dom-to-image-more 注入
    tauri.js                # Tauri Rust 后端桥接
    performance.js          # 前端操作与渲染性能采集
  styles/main.css           # 应用样式
public/
  i18n.js                   # 多语言文本
  app/                      # 前端功能模块（按职责拆分）
    core.js                 # 状态、文档、侧栏、设置与布局
    scroll-sync.js          # 双向滚动与划词定位
    bootstrap.js            # 初始化与状态恢复
    preview.js              # Markdown 预览渲染
    export.js               # 保存、导入与导出
    editor-tools.js         # 编辑命令、图片、表格与 Mermaid
    web-clipper.js          # 网页抓取与 HTML 转 Markdown
    events.js               # 全局事件、拖放与快捷键
src-tauri/                  # Tauri / Rust 桌面后端
  src/main.rs
  src/document_store.rs     # 超大文档增量日志与双槽快照
  src/web_fetch.rs
  src/performance_log.rs    # 性能日志落盘
logs/                       # 开发者性能日志目录
scripts/
  architecture/             # 架构事实提取、规则检查、仓库读取与 CLI 基础模块
  verify-architecture.mjs   # 全量架构硬门禁
  verify-no-legacy-runtime.mjs
  verify-generated-files.mjs
  verify-readme-record.mjs
```

## Stage 1 架构交接

阶段 1 已完成，只交付可执行的架构基础与迁移门禁；阶段 2 尚未开始，不得宣称业务功能已经迁移。当前生产应用仍由 `src/main.js` 与 9 个经典脚本启动，其中包括 `public/app/*.js` 和 `public/i18n.js`；阶段 1 清单仍覆盖 67 个生产模块。

### 阶段 2 可依赖的公共架构 API

- `src/app/create-application.js`：`createApplication(dependencies)`，公开冻结的 `commands`、`events`、`start()` 与 `destroy()`。
- `src/app/application-lifecycle.js`：`LIFECYCLE_STATES`、`createApplicationLifecycle(participants)`。
- `src/app/disposer-registry.js`：`DISPOSER_REGISTRY_STATES`、`createDisposerRegistry()`。
- `src/app/commands/command-ids.js`：`assertCommandId()`、`defineCommandIds()`。
- `src/app/commands/command-registry.js`：`createCommandRegistry()`、`DuplicateCommandRegistrationError`、`CommandNotRegisteredError`。
- `src/app/commands/command-bus.js`：`createCommandBus()`。
- `src/app/events/event-types.js`：`assertEventType()`、`defineEventTypes()`。
- `src/app/events/event-bus.js`：`createEventBus()`、`EventBusDestroyedError`、`InvalidEventPayloadError`。
- `src/model-kernel/index.js`：冻结 JavaScript 模型能力的唯一公共入口，精确公开 26 个既有符号；非模型模块不得绕过该入口导入冻结实现。

### 状态所有权与依赖边界

- `application-lifecycle.js` 唯一拥有应用生命周期状态与活动参与者栈。
- `disposer-registry.js` 唯一拥有单个模块登记的资源清理状态。
- `command-registry.js` 唯一拥有命令 ID 到处理器的映射；`command-bus.js` 只负责路由。
- `event-bus.js` 唯一拥有事件订阅状态，并只发布深层冻结的普通数据快照。
- Feature 不得反向依赖 `src/app/` 内部；跨 Feature 只能依赖目标 Feature 的公共 `index.js`；Platform 不得导入 Feature；Model Kernel 不得导入高层模块；生产 JavaScript 模块不得形成循环依赖。

### 迁移基线与删除候选

当前精确迁移基线锁定 9 个经典脚本、184 个内联事件、38 个业务全局写入和 4 个跟踪运行产物，且不允许通配豁免。`public/app/*.js`、`public/i18n.js` 和旧 `src/main.js` 启动链是后续分阶段迁移与删除候选，不得提前删除；每次移除遗留事实时必须在同一受审变更中同步缩减精确基线并完成回归。

### 验证入口

```bash
npm run verify:architecture
npm run verify:no-legacy-runtime
npm run verify:generated-files
npm run verify:readme-record
npm test
npm run test:browser:contract
npm run build
npm run check
```

涉及桌面或 Rust 链路时继续执行锁文件约束下的 `cargo test`、`cargo check` 与 Tauri release build。架构检查只读取仓库源码和本地 Git 事实，不依赖构建产物或联网。

### 已知限制

- 新组合根、生命周期、命令和事件基础设施尚未接入生产启动链。
- 真实业务命令、事件目录和 Feature 迁移必须在对应后续 Atomic Task 中逐条建立和验证。
- 当前完整桌面基线在 Ubuntu 22.04 验证；Windows 原生窗口、文件关联和系统拖放仍需在涉及这些路径的阶段执行真实平台验证。

## Change Log
<!-- stage-02-node:02-01 -->
- 2026-08-05：阶段 2 Atomic Task 2.1（DOM 资产盘点）完成：新增模块化 HTML 解析、仓库选择器/class 证据扫描和迁移映射工具，冻结旧 `index.html` 的 1054 个元素、173 个 ID、140 个静态 class、184 个内联事件、72 个 ARIA 节点、351 个生产选择器调用、45 个测试选择器调用及 225 个 class 变更调用，并将全部节点唯一分配到 31 个语义区域；无归属和多重归属均为 0。专项 run 30992035044 与完整基线 run 30992034408 全部通过；生产 `index.html`、CSS、JavaScript、Rust、启动链、依赖、锁文件、冻结契约和用户行为未改变，Atomic Task 2.2 尚未开始。
<!-- stage-01-node:01-10 -->
- 2026-08-05：阶段 1 Atomic Task 1.10（README 与架构交接）完成：新增 `## Stage 1 架构交接`，公开阶段 2 可依赖的组合根、生命周期、资源清理、命令、事件与冻结模型入口，明确单一状态所有者、依赖方向、精确迁移基线、删除候选和已知限制；新增交接契约测试与结构化 CI 证据。专项 run 30986994815 与完整基线 run 30986994863 全部通过，生产模块仍为 67 个，生产启动链、业务行为、冻结契约、依赖和锁文件未改变；阶段 1 已完成，阶段 2 尚未开始。
<!-- stage-01-node:01-09 -->
- 2026-08-05：阶段 1 Atomic Task 1.9（package scripts）完成：在 `package.json` 新增 `verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files` 和 `verify:readme-record` 四个本地 Node 验证入口，并新增独立契约测试，精确锁定既有 9 个 package 命令语义、目标脚本路径以及无构建产物、包安装或联网依赖。专项 run 30973431231 与完整基线 run 30973431241 全部通过，`package-lock.json`、依赖、生产模块、冻结契约和用户行为未改变；Atomic Task 1.10 尚未开始。
<!-- stage-01-node:01-08 -->
- 2026-08-05：阶段 1 Atomic Task 1.8（架构脚本）完成：新增模块化架构扫描器与四个独立执行入口，建立无通配豁免的精确迁移基线，逐项锁定 9 个经典脚本、184 个内联事件、38 个业务全局和 4 个既有跟踪运行产物；新增依赖方向、跨 Feature 内部导入、循环依赖、模块导入副作用、生成文件、旧后缀和 README 记录门禁。专项 run 30970380961 与完整基线 run 30970380963 全部通过，生产模块仍为 67 个，生产实现、冻结契约、依赖和用户行为未改变；Atomic Task 1.9 尚未开始。
<!-- stage-01-node:01-07 -->
- 2026-08-05：阶段 1 Atomic Task 1.7（模型稳定入口）完成：新增 `src/model-kernel/index.js`，以 26 个显式命名导出统一公开 8 个冻结 JavaScript 模型模块，并将应用启动、混合编辑、预览 Worker 与数学展示调用者切换到稳定入口；新增导出集合、引用身份、函数签名、冻结哈希和禁止绕过入口的架构门禁，生产模块清单增至 67 个。专项 run 30964745475 与完整基线 run 30964745509 全部通过，9 个冻结模型/数据契约文件、公共行为、持久化和依赖保持不变；Atomic Task 1.8 尚未开始。
<!-- stage-01-node:01-06 -->
- 2026-08-05：阶段 1 Atomic Task 1.6（事件类型与事件总线）完成：新增 `src/app/events/event-types.js` 和 `event-bus.js`，建立事件类型集中声明、深层冻结普通数据快照、精确幂等退订、`once` 调用前移除、同步/异步监听器异常隔离和幂等销毁；生产模块清单增至 66 个。专项 run 30961354098 与完整基线 run 30961354097 全部通过，现有生产入口和用户行为未切换，Atomic Task 1.7 尚未开始。
<!-- stage-01-node:01-05 -->
- 2026-08-04：阶段 1 Atomic Task 1.5（命令注册表与命令总线）完成：新增 `src/app/commands/command-ids.js`、`command-registry.js` 和 `command-bus.js`，建立集中命令 ID、唯一处理器所有权、重复注册拒绝、精确幂等注销、Promise 化执行、缺失命令拒绝及业务异常原样传播；生产模块清单增至 64 个。专项 run 30923323509 与完整基线 run 30923323395 全部通过，现有生产入口和用户行为未切换，Atomic Task 1.6 尚未开始。
<!-- stage-01-node:01-04 -->
- 2026-08-04：阶段 1 Atomic Task 1.4（资源销毁注册表）完成：新增 `src/app/disposer-registry.js`，统一拥有资源清理登记、严格 LIFO、提前幂等释放、并发清理、异常聚合和失败项重试；生产模块清单增至 61 个。专项 run 30920143493 与完整基线 run 30920143387 全部通过，现有启动链和用户行为未切换，Atomic Task 1.5 尚未开始。
<!-- stage-01-node:01-03 -->
- 2026-08-04：阶段 1 Atomic Task 1.3（应用生命周期状态机）完成：新增 `src/app/application-lifecycle.js`，统一拥有 `idle / starting / running / stopping / failed` 状态、并发幂等、注册顺序启动、严格逆序回滚与销毁、异常聚合和失败清理重试；生产模块清单增至 60 个。专项 run 30911793856 与完整基线 run 30911794047 全部通过，现有启动链和用户行为未切换，Atomic Task 1.4 尚未开始。
<!-- stage-01-node:01-02 -->
- 2026-08-04：阶段 1 Atomic Task 1.2（最小组合根）完成：新增纯依赖注入的 `src/app/application-context.js` 与 `src/app/create-application.js`，公开 `start()`、`destroy()`、`commands` 和 `events`，构造期间不访问 DOM、Storage、Tauri 或 Worker，也未接入现有启动链；专项验证 run 30906897816 与完整基线回归 run 30906897895 全部通过。Atomic Task 1.3 尚未开始。
<!-- stage-01-node:01-01 -->
- 2026-08-04：阶段 1 Atomic Task 1.1（基线与模块清单）完成：建立覆盖 57 个生产 JS/Rust/CSS/HTML 文件的机器可读职责、状态所有权、生命周期、迁移处置和冻结边界清单，并新增真实导入、导出、监听器、全局写入与副作用采集器；专项验证 run 30904310568 和完整基线回归 run 30904310598 全部通过。未修改生产行为，Atomic Task 1.2 尚未开始。
<!-- stage-00-run:30898202198:1 -->
- 2026-08-04：阶段 0 基线阻塞修复完成并通过 GitHub Actions 完整门禁（run 30898202198）：Node 测试、浏览器契约、应用浏览器回归 7/7、前端构建、Rust test/check 与 Tauri Linux release build 全部通过；最低 Rust 工具链调整为 1.88.0，冻结模型和公共契约未改变。阶段 0 完成，阶段 1 尚未开始。
- 2026-07-26：左侧“文档 / 大纲”导航增加“文件”文件树页，递归显示当前本地文档所在文件夹中可读取的 `.md`、`.markdown` 与 `.txt` 文件；目录支持展开/折叠、手动刷新和当前文件高亮，点击文件会复用已打开的会话文档或安全打开新文档。Rust 后端负责有界目录扫描，跳过符号链接、超大或不可读取文件，并记录文件数、跳过项与截断状态。
- 2026-07-25：修复混合模式代码块上方出现额外高光的问题：源码活动行不再覆盖已由可视组件替换的块范围，代码块仍保持原有的回车创建与展示行为，空白处点击只高亮实际光标行。鼠标落点诊断仅在位置或行号确实发生校正时记录，正常空白区点击不再产生误导性 warning；常规 HTML 语法树补偿改为正常诊断。新增代码块占位与高光隔离回归测试。
- 2026-07-25：稳定性打磨第三阶段收敛高风险展示链路：新增统一 `markdownEditorPresentation` API，代码高亮、KaTeX 与 Mermaid 由混合模式、实时预览及导出共同调用；移除混合/预览各自维护的 Mermaid 加载、主题初始化、SVG 归一化与缓存逻辑，公式分隔符和错误回退也集中管理。浏览器回归新增混合/预览 Mermaid SVG 一致性检查，并为完整应用预留跨视图渲染验证。
- 2026-07-25：稳定性打磨第二阶段建立真实浏览器交互回归层：新增无第三方测试依赖的 Chromium DevTools Protocol 驱动、显式 E2E 桥接与虚拟文件宿主，覆盖单击、严格双击、跨组件快速点击、拖选、失焦退出、组件互斥编辑和视图切换；代码块与表格直接编辑增加捕获阶段的外部指针关闭，避免不可聚焦区域无法触发 blur。完整应用 E2E 会拒绝旧 dist，必须先由当前源码完成生产构建。
- 2026-07-25：开始稳定性打磨第一阶段：为代码块、Mermaid、表格、LaTeX、HTML 与图片建立统一的展示 / 直接编辑 / 源码编辑状态机，同一时间只允许一个组件处于交互编辑状态；新组件打开时会先关闭并提交上一组件，延迟失焦事件不会再覆盖已经切换到的源码状态。新增固定混合模式回归文档、Node 状态机测试及 `npm test` / `npm run check` 验证入口。
- 2026-07-18：修复混合模式 Mermaid 退出源码/直接编辑后组件重建滞后：源码范围在 pointerdown 阶段同步关闭，避免布局切换后的旧坐标把光标重新放回源码；同一图表按源码、主题和块位置缓存已生成 SVG，未修改内容时恢复组件即可立即显示。Mermaid 连线标签背景改为与编辑面板一致，不再出现两块固定灰底；应用二级菜单增加 1 秒离开宽限，鼠标从一级菜单跨越间隙滑向二级菜单时不会立即消失。
- 2026-07-18：混合模式中的 `mermaid` 围栏代码块改为直接渲染 Mermaid SVG 图表，不再以普通代码高亮组件显示源码；图表复用实时预览的 Mermaid 主题与渲染器，支持亮暗主题切换、复制源码、编辑源码及可选的双击直接编辑，并在异步渲染完成后刷新编辑器几何与滚动/划选定位。
- 2026-07-18：修复混合模式单击 Markdown 链接时 CodeMirror 先移动光标并展开链接源码的问题：链接在鼠标按下阶段即拦截编辑器选区处理，普通单击直接打开应用内链接预览，Ctrl/⌘ 或 Shift 点击继续交由系统浏览器；混合 HTML 链接采用相同规则。
- 2026-07-18：修复预览区文档链接直接替换主编辑器 WebView、无法返回的问题：HTTP/HTTPS 链接改为应用内全屏预览层，右上角提供明确的关闭按钮和“在浏览器打开”入口，Esc 可返回编辑器；链接点击统一拦截并阻止主窗口导航，邮件和电话协议继续交由系统处理。
- 2026-07-18：统一混合模式与实时预览的 Markdown 转义及引用式链接：混合列表项会隐藏 `\*`、`\#`、`\[`、`\]`、`\|` 中仅用于转义的反斜杠并保留字面字符；非 Worker 增量预览现在携带全文引用定义上下文，定义变化会使相关预览块重新渲染，`[文字][label]` 不再显示原始源码。
- 2026-07-18：修复实时预览把 Markdown 转义方括号 `\[文字\]` 误识别为 LaTeX 块公式的问题：`\[...\]` 仅在分隔符位于独立公式行时进入数学渲染，普通段落和列表中的转义方括号恢复为字面文本；Preview Worker、完整预览、导出及双向选择映射统一采用同一判定规则。
- 2026-07-18：修复混合模式引用按源码行逐条绘制竖线的问题：引用前缀改为按嵌套深度生成连续结构边线，空引用行保持外层边线连贯，嵌套引用增加独立层级缩进；引用内无序、有序及任务列表在去除引用前缀后继续按正常列表渲染，使混合模式结构与实时预览一致。
- 2026-07-18：修复混合模式在非折叠划选时错误展开 Markdown 标记的问题，选区改为逐行、逐字符绘制并保持标题、强调、链接和引用的可视化样式；补充语法树未完成时的行内格式兜底及引用式链接解析，隐藏非活动引用定义行。实时预览 Mermaid 改为逐图显式生成 SVG，并在异步任务因视图切换取消后自动重试未渲染图表，同时记录渲染成功、失败与取消数量。
- 2026-07-17：修复混合模式在文档刚载入或快速跳转时只渲染部分 HTML 的问题：当 CodeMirror 后台语法树尚未覆盖当前可视区时，使用有界 HTML 块与行内标签扫描补齐 `<details>`、`<div>`、注释及常见行内标签，并在日志中记录补偿范围；同时修复光标位于单个列表项时错误跳过整个列表祖先、导致其他项目内联格式全部显示源码的问题。
- 2026-07-17：补齐混合模式与实时预览的 HTML 展示一致性：原生 HTML 块改为可视化组件并保留“编辑源码”入口，常见行内 HTML 标签在混合模式中按对应样式呈现；多光标只让主光标所在块进入源码状态。修复拖拽选区轻微跨入下一行就多选半行的问题，鼠标移动期间按实时视觉行几何定位，并在跨行边界加入上/下半行滞后判定，同时降低落点校正日志频率。
- 2026-07-17：修复编辑器与混合模式在软换行长行、HTML 源码及展开后的图片 data URL 中鼠标落点偏移的问题：移除覆盖 CodeMirror 换行测量的行级断词规则，并新增基于浏览器原生 caret DOM 边界、目标物理行约束和坐标校验的精确鼠标选区扩展；仅在检测到行号或垂直坐标偏差时进行局部校正并记录诊断日志。
- 2026-07-17：重构混合模式与源码/预览双向划选映射：按可见字符建立 Markdown 源码到预览 DOM 的精确边界映射，覆盖标题、列表、强调、链接、表格、代码高亮、图片与 LaTeX 原子组件；跨块选择使用多 Range 高亮，预览反选源码不再按比例估算，映射失败时也不再扩大为整块高亮。混合模式拖动选区仅暴露实际选中字符，不再把起止段落整体切回源码样式；性能日志新增映射模式、覆盖率和源码范围字段。
- 2026-07-17：修复源码驱动可视化组件的单击编辑绕过：代码块、表格、行内与块级 LaTeX 只有显式双击或“编辑源码”后才解除源码保护，普通选区进入组件范围不再自动展开；单击组件会把键盘焦点停留在只读组件本身，避免旧 CodeMirror 光标在相邻空行接收输入。
- 2026-07-17：修复可视化组件编辑状态未在点击外部空白区域后立即退出的问题；代码块和表格的直接编辑控件失焦后同步关闭，代码块、表格与 LaTeX 源码展开状态在选区离开或点击编辑器空白区域时立即收起，并新增直接编辑关闭及源码编辑关闭的语义日志。
- 2026-07-17：修复原生 `dblclick` 在同一可视化组件内把不同子元素的快速点击误判为双击的问题；代码块、表格、LaTeX 与图片统一改用严格双击判定，要求同一组件区域、主键、420ms 内且两次落点距离不超过 8px。性能日志新增可视化组件目标、点击次数及实际编辑入口的间隔/距离字段。
- 2026-07-17：将表格纳入源码驱动可视化组件的统一交互规则：单击只保持展示，深度编辑开启后双击单元格才进入直接编辑，“编辑源码”切换完整 Markdown 源码；新增表格编辑打开、提交、取消与源码切换的语义化性能事件。开发模式性能日志改为每次应用进程启动创建独立文件，不再按日期把多次启动追加到同一 JSONL。
- 2026-07-17：统一代码与 LaTeX 可视化组件的源码进入规则：围栏代码块、缩进代码块、行内公式和块级公式单击均只保持展示，不再因 CodeMirror 选区或 Enter / F2 自动展开源码；仅双击或块级组件的“编辑源码”按钮进入对应源码。
- 2026-07-17：修复代码块与公式交互：所有代码块单击仅保持展示，深度编辑开启后仅双击进入直接编辑，“编辑源码”即时移除对应组件并精确选中源码范围，同时消除 CodeMirror 自绘选区与浏览器原生选区叠加造成的错位高亮；块级 KaTeX 公式取消内部纵向滚动并保留完整上下标，预览增强队列补齐 `\(...\)` 与 `\[...\]` 公式检测。

- 2026-07-17：新增可持久化的“代码块深度可视化编辑”开关，有语言、无语言围栏代码块和缩进代码块统一支持直接编辑、F2 / 双击切换源码及安全围栏扩展；“插入”菜单新增行内与块级数学公式，混合模式支持 KaTeX 原地渲染和源码切换，预览、Worker 与导出统一支持 `$...$`、`$$...$$`、`\(...\)` 和 `\[...\]`。
- 2026-07-17：修复顶层菜单动画导致二级菜单视口坐标重复叠加、横向远离父菜单的问题；表格深度编辑开启后恢复单元格双击与 F2 切换源码；统一混合模式与预览模式代码块的行号、语法高亮和工具栏视觉，并让代码块背景与高亮配色随亮色/暗色主题切换。
- 2026-07-16：完成混合编辑第三阶段表格能力：保留表格可视展示与“编辑源码”切换，在“插入”菜单增加可持久化的“表格深度可视化编辑”开关；开启后可直接编辑表头和数据单元格，Tab / Shift+Tab 横向切换，Enter / Shift+Enter 纵向切换，写回时保留 Markdown 表格结构并支持撤销；关闭后恢复只读展示。同步恢复二级标题原有的 1.75 倍字号并移除混合模式额外下边线。
- 2026-07-16：修复列表空项回车产生无标记空行、需要第三次回车才能退出的问题；无序、有序和任务列表现在在非空项回车时继续下一项，在空项再次回车时直接退出列表。
- 2026-07-16：根据混合模式测试日志优化诊断与索引链路：混合模式统一使用增量 Worker 维护大纲和文档统计，不再随每次输入生成全文快照；新增装饰构建、组件范围、索引版本与长度异常的去重日志；移除无效鼠标移动和混合模式空选择同步日志；插入链接改为非阻塞模态框，避免同步系统提示框造成界面长时间停顿。
- 2026-07-15：完成混合编辑模式第二阶段：复杂块组件统一接入尺寸生命周期管理，组件与源码切换保持视口位置；本地及相对图片路径由 Rust 按当前 Markdown 文件目录解析并提供失败重试；图片、表格和代码块异步尺寸变化后自动校准滚动与划词定位，并避免几何变化触发装饰重建循环。
- 2026-07-15：移除混合编辑外部链接对 `@tauri-apps/plugin-opener` 的新增依赖，改由现有 Tauri invoke 桥接到项目自带 Rust 命令打开受支持链接，全量项目包可直接使用现有依赖清单安装并构建。
- 2026-07-15：重构单视图混合编辑模式为独立块级子系统，复杂 Markdown 块按可视区生成源码驱动组件；首批支持任务复选框回写、Ctrl/⌘ 点击外部链接、独立图片、完整表格以及带行号、轻量语法高亮和复制按钮的代码块。
- 2026-07-15：修复应用菜单二级菜单被一级菜单滚动容器裁切的问题，二级菜单按视口空间自动向左或向右展开；应用启动时不再自动创建空白文档，首次实际编辑时才创建会话文档。
- 2026-07-14：修复快速拖动窗口尺寸后前端短暂无响应：窗口缩放期间禁用 View Transition 截图动画，处理被中止的过渡 Promise，响应式侧栏与单面板切换改为无动画即时提交，并为紧凑布局阈值增加回差区间，避免边界附近反复切换。
- 2026-07-14：恢复工具栏原有按钮、文字与分组显示；改为检测工具栏内容的实际边界，仅在单行即将重叠时使用原有双行布局，不隐藏工具、不增加“更多”菜单。
- 2026-07-14：未自动保存文档的关闭确认改为“保存并关闭”；本地文件写入改由 Rust 命令直接处理系统绝对路径，修复扩展路径被文件系统权限范围拒绝；窗口采用 600×480 紧凑下限，宽度不足时自动折叠侧栏并将顶层菜单切换为图标模式，同时修复极窄窗口下一层菜单被裁切的问题。
- 2026-07-14：文档关闭改为仅在自动保存尚未执行或保存失败时提示未保存修改，侧栏文档增加快捷关闭按钮；大纲支持全局展开/折叠及按节点折叠子树；取消桌面窗口最小尺寸限制；“编辑 + 预览”在窄窗口自动切换为互斥单面板。
- 2026-07-14：修复语言初始化覆盖分类帮助页面的问题；“使用帮助”现在保留左侧分类导航，只显示当前选中的帮助页面。
- 2026-07-14：优化编辑器与实时预览的双向划词定位：按选区在来源视口中的实际纵向位置自适应对齐目标视口，窗口和分栏尺寸变化后自动重新校准；重复文本按源码区间选择最近匹配，虚拟预览挂载和高度修正后保持选区位置。
- 2026-07-14：撤销不稳定的手写 Windows 窗口裁切与 DWM 边框覆盖，改由 Tauri/Windows 原生管理未装饰窗口阴影和圆角；移除应用内部重复外框，并补齐标题栏拖动、最小化、最大化、还原及状态读取权限。
- 2026-07-14：修复 Windows 自定义窗口右上角出现缺口和锯齿的问题，移除按窗口尺寸反复执行的 `SetWindowRgn` 裁切，改用 Windows 11 DWM 原生圆角与边框属性，避免缩放和拖拽调整窗口时产生边缘残片。
- 2026-07-14：修复自定义窗口透明渲染造成的外层方框、8px 空白边和双层阴影；窗口恢复为不透明 WebView 并铺满原生窗口，Windows 端使用原生窗口区域实现 16px 圆角，最大化时自动取消圆角。
- 2026-07-14：打包后的桌面窗口改为无原生标题栏的自定义窗口壳层，增加 16px 圆角；最小化 / 最大化 / 关闭按钮移入应用顶部菜单栏右侧；“本地编辑”移到底部状态栏左侧，并移除左下角自动保存提示文本。
- 2026-07-14：根据性能日志修复预览面板在布局稳定前渲染造成的首屏空白，切换到双栏/实时预览时主动等待有效尺寸并刷新虚拟视口；章节预览至少加载 24 个上下文块；应用重启后侧栏从空白会话开始，仅在“最近打开”保留最多 20 个外部文件路径。
- 2026-07-14：清理全部旧品牌标识与内部命名；修复从仅编辑/单视图切回实时预览时首帧不显示的问题；设置与帮助改为可切换的分类页面。
- 2026-07-14：重设计应用界面为现代桌面创作工具风格，统一顶部菜单、格式工具栏、侧边栏、编辑/预览工作区、菜单与模态框的视觉层级，并同步优化亮色/暗色主题和窄屏适配。
- 2026-07-14：侧边栏支持拖拽调整宽度并记忆；应用级快捷键改为全局链路；启动时文档侧栏仅保留当前文档，最近打开文件迁移到“文件 > 最近打开”并限制 20 条；Tauri 拖入文本文件保留原始路径，可直接覆盖保存。

## 功能

- CodeMirror 6 可视区虚拟编辑与实时预览
- 顶部应用菜单栏：文件、编辑、视图、插入、应用
- Typora 风格左侧栏：本地文档切换、大纲标题跳转
- 分类设置面板：通用、编辑器、保存与导出、工具栏、性能
- 左侧源码编辑 / 右侧实时预览
- 多主题
- 多语言
- 本地导入与拖拽导入
- Markdown / HTML / Word / PDF / 图片导出；桌面端“另存为 Markdown”使用系统文件选择器，可选择保存位置
- KaTeX 数学公式
- Mermaid 图表
- 从网页导入 Markdown
- 桌面版通过 Rust 后端抓取网页，不依赖 Python 代理

## 开发者性能日志

应用会把前端交互、预览渲染、滚动与划词同步、文档操作、导入导出、Rust 命令、长任务、异常和定期运行状态写入根目录：

```text
logs/performance-YYYY-MM-DD_HH-mm-ss-SSS_pid-PID.jsonl
```

每次启动桌面应用都会创建一个新的日志文件；同一次启动内的 Rust 与前端事件写入同一文件。日志采用 JSON Lines 格式，一行代表一次操作或一组高频操作的聚合结果。高频滚动、输入和同步事件按时间窗口聚合，字段包含调用次数、平均耗时、最小耗时和最大耗时，避免日志采集本身影响编辑流畅度。日志不会记录 Markdown 正文、网页内容或本地文件完整路径。

性能日志仅在开发模式启用，并固定写入项目根目录 `logs/`。正式发布版本不启动性能采集、不创建 `logs/` 目录，也不会写入性能日志。开发模式下可通过环境变量 `MARKDOWN_EDITOR_LOG_DIR` 指定日志目录。

## 开发运行

需要安装：

- Node.js
- Rust
- 系统 WebView 运行依赖

安装前端依赖：

```bash
npm install
```

前端依赖包含 CodeMirror 6（`@codemirror/state`、`@codemirror/view`、`@codemirror/lang-markdown`、`@codemirror/commands`），以及 Tauri 文件对话框和文件写入插件（`@tauri-apps/plugin-dialog`、`@tauri-apps/plugin-fs`）。外部链接由项目自带的 Rust 命令处理，不新增前端插件依赖。

启动 Tauri 桌面开发模式：

```bash
npm run tauri:dev
```

使用 pnpm 时：

```bash
pnpm install
pnpm tauri dev
```

项目已在 `pnpm-workspace.yaml` 中仅允许 `esbuild` 执行必要的安装脚本，兼容 pnpm 11 的依赖构建安全策略，无需再手动运行 `pnpm approve-builds`。

仅启动前端预览：

```bash
npm run dev
```


## 回归验证

运行固定 Node 回归测试：

```bash
npm test
```

运行不依赖构建产物的真实 Chromium 交互契约测试：

```bash
npm run test:browser:contract
```

生产构建完成后，运行完整应用交互测试：

```bash
npm run build
npm run test:browser
```

需要指定 Chromium / Chrome 时：

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:browser:contract
```

执行全部回归、生产构建和完整应用交互测试：

```bash
npm run check
```

完整应用测试会校验 `dist` 是否包含当前源码的 E2E 桥接，旧构建产物会被明确拒绝。固定回归文档位于 `tests/fixtures/hybrid-regression.md`，覆盖强调、链接、引用、表格、普通代码块、Mermaid、LaTeX、HTML 与精确拖选文本。

## 构建桌面应用

```bash
npm run tauri:build
```

或：

```bash
pnpm tauri build
```

构建产物位于：

```text
src-tauri/target/release/bundle/
```

Windows 构建生成 NSIS 安装程序。安装向导支持自定义安装目录；使用相同应用标识安装时会覆盖升级现有版本，并注册 `.md` / `.markdown` 文件关联。双击关联文件会直接在编辑器中打开。

## 说明

桌面版网页抓取由 `src-tauri/src/web_fetch.rs` 提供。浏览器预览模式下仍可使用公共 CORS fallback 或手动粘贴 HTML。

左侧“文档”仅用于当前运行会话内的文档切换；应用重新打开时侧栏从新的空白文档开始，不恢复上次会话条目。左侧“文件”页递归显示当前本地文档所在目录中可读取的 Markdown/TXT 文件，未保存到本地的会话文档不会生成文件树。外部文件历史位于“文件 > 最近打开”，最多保存 20 条。左侧“大纲”根据当前 Markdown 标题实时生成，点击后跳转到对应源码行。

## Large-document performance

- Single-view hybrid editing reuses the same CodeMirror document state instead of maintaining a second rich-text editor. The active cursor block and selected ranges always expose raw Markdown, while other visible blocks receive heading, quote, list, emphasis, link, and code presentation decorations.
- Hybrid mode suspends independent preview-DOM commits while the Preview Worker continues maintaining headings, statistics, and block indexes. Switching back to split view rebuilds the preview from the synchronized worker model.
- Presentation decoration is limited to CodeMirror's visible ranges, so million-character documents do not trigger a full-document styling pass. IME input, undo, persistence, and search continue through the original transaction pipeline.
- CodeMirror 6 renders only source lines near the viewport while the full document remains in its state tree.
- A unified `DocumentModel` now owns the active document generation, version, and transaction journal. The preview Worker, search/replace, and Rust persistence paths consume the same change source instead of maintaining separate incremental state.
- Preview and storage acknowledge their synchronized versions independently. Confirmed transactions are reclaimed, while a lagging consumer falls back to one explicit full snapshot only after it has left the retained journal window.
- Full strings are created only through explicit, reason-tagged snapshots. Formatting, selection sync, search, and local replacements read bounded ranges instead of implicitly copying a million-character document.
- A compatibility adapter preserves the existing value, selection, replacement, and scroll APIs used by toolbar commands and document storage.
- The preview keeps a top-level Markdown block model, re-lexes only the changed window for ordinary edits, and reuses unchanged DOM nodes.
- Incremental block comparison uses linear indexes, avoiding quadratic growth during full updates of very large documents.
- Markdown block parsing for documents above 100,000 characters runs in a Web Worker. The UI thread receives only changed blocks and source ranges, and rapid input coalesces pending work to the latest request.
- The worker pre-renders up to 96 blocks or about 120,000 characters around the heading chapter that contains the cursor. Moving into another chapter refreshes only that priority window.
- Global Markdown reference definitions are still analyzed for correctness in the worker, but they no longer force the UI thread to build a complete preview DOM. A definition change invalidates cached block HTML and refreshes the current virtual window.
- Math and Mermaid enhancements run through a versioned idle queue. A newer preview version cancels pending stale jobs, while the current chapter and mounted blocks receive priority.
- The virtual preview prewarms up to 96 blocks ahead of the current scroll direction in the worker. Entering a new region can reuse prepared HTML instead of parsing Markdown synchronously on the UI thread.
- Heavy preview enhancements are scheduled in three tiers: truly visible blocks, the current chapter, then overscan-buffer blocks.
- Documents above 400,000 characters or roughly 2,600 preview blocks use a real preview window: only 24–180 rich blocks around the viewport are mounted, while a height index and top/bottom spacers preserve the full scroll range.
- Preview strategy can be set to Auto, Full Virtual, Current Chapter, or Complete Preview. Auto mode scales by character and block count, and defaults million-character documents to the current-chapter strategy while still allowing a manual override.
- Current-chapter mode renders the worker-provided chapter snapshot without creating a full preview DOM. The scope changes only when the cursor crosses a chapter boundary, while incremental updates and visible-node animations remain active inside the chapter.
- Images, math, and Mermaid are enhanced only when a virtual block enters the mounted window. ResizeObserver recalibrates asynchronous height changes, and animations remain limited to visible changed blocks.
- Preview anchors are cached and searched with binary lookup; raw scroll events are coalesced to one synchronization pass per animation frame.
- Sidebar, pane, menu, modal, highlight, and preview-block animations remain enabled; incremental preview animation is limited to changed nodes.
- Split-pane, sidebar, and window resize updates rebuild line metrics only after the layout settles.
- The incremental block model carries source line and character ranges, avoiding a second full-document parse for preview positioning; bidirectional scroll synchronization uses the virtual height index for off-screen blocks.
- Word count is maintained from editor change transactions, so each keystroke no longer rescans a million-character document.
- Undo and redo use CodeMirror transaction history instead of copying a complete large-document snapshot every 400 ms.
- Once the worker is synchronized, ordinary preview refreshes submit editor transactions without rebuilding the complete document string on the UI thread.
- Find-next scans CodeMirror text in chunks instead of allocating a complete document string for every search. Replace-all is submitted as one editor transaction instead of repeatedly slicing and concatenating a million-character string.
- If the preview worker fails, very large documents do not fall back to a synchronous full render on the UI thread. The last stable preview is retained, or a lightweight recovery state is shown.
- In Tauri, documents at or above 100,000 characters migrate to the Rust background store: the first write creates a full snapshot and later autosaves submit only CodeMirror change transactions.
- Rust appends transactions to a journal and compacts it into validated dual-slot snapshots after 24 writes, at 2 MB, or on manual save. The other slot remains available for recovery if a write is interrupted.
- On load, the Rust store validates snapshot integrity, UTF-8, journal version continuity, and transaction ranges. A truncated or corrupted journal tail is discarded after the verified prefix, then folded into a new safe snapshot with a recovery notification.
- If the active snapshot is damaged, the alternate slot is tried automatically. Loading fails only when both slots are unusable, avoiding silent recovery from invalid content.
- The status bar reports queued, background-saving, snapshot-complete, and failed states. Repeated saves with the same editor version and title are skipped instead of appending empty journal entries.
- Word, HTML, PDF, and image exports build complete output in batches with visible progress. Parsing, enhancement, and image preparation can be cancelled; the final PNG encoding stage is explicitly marked as non-interruptible.
- Snapshots are always written to the inactive slot. Before a Tauri window closes, the app waits for the final transaction batch and snapshot compaction; a failed final flush keeps the window open instead of silently discarding recent edits.
- After migration, localStorage keeps only document metadata rather than serializing the full million-character body on each autosave. Browser-only development keeps the existing localStorage fallback.
- Continuous input in large documents is merged into a delayed preview refresh; documents above 400,000 characters use a longer idle delay while editor input remains immediate.
- The outline DOM is rebuilt only when its heading structure changes; ordinary paragraph edits only update the active heading.
- Source anchors are attached first, while outline and selection enhancements run during idle time; anchor coordinates are prewarmed before the first scroll.
- Preview prewarming, post-processing, heavy enhancements, index caching, and height-cache writes share a cancellable priority scheduler. A newer task replaces stale work while input and visible-region updates remain first.
- The worker maintains an incremental heading index and document statistics. The UI no longer scans every Markdown block after each preview update, and a fingerprinted outline cache can be restored during startup.
- Existing documents no longer load a legacy full-text value before the current document overwrites it. The first frame paints before the body, indexes, and preview are restored, avoiding duplicate CodeMirror state construction for million-character files.
- The Rust store now returns a document manifest, character/line counts, and heading index before streaming content to the UI in roughly 512 KB chunks. CodeMirror builds its document directly from those chunks instead of requiring the UI thread to concatenate a million-character string first.
- The initial preview-worker reset can reuse the startup chunks, avoiding a full `toString()` on the UI thread. The temporary chunk cache is released after the worker acknowledges the document.
- Native-backed documents above 400,000 characters use Rust for find-next after pending editor transactions are persisted. A sparse UTF-16 index maps Chinese and emoji positions without scanning the complete document on the UI thread.
- The native heading index can populate the outline before body transfer completes. Chunk progress is reported, and a newer open request cancels an older unfinished load.
- Measured virtual-preview heights are persisted by document, theme, font size, and width bucket. Reopening the same document restores the height index before the first virtual layout, reducing scroll-range correction and initial position jumps.
- Replace-all scans CodeMirror text in 64 KB chunks and submits one transaction without first materializing a second full-document string.


## Scroll synchronization controller

Bidirectional editor/preview scrolling is owned by `src/sync/scroll-controller.js`. Only explicit wheel, touch, scrollbar pointer, or scroll-key input can acquire source ownership. Linked scrolling, navigation scrolling, and virtual-preview height compensation cannot become a reverse synchronization source. The virtual preview maps source lines directly through its block-height index and asks the controller to recalibrate from the active user side after geometry changes.

## Selection synchronization controller

Editor/preview text-selection synchronization is owned by `src/sync/selection-controller.js`. It waits for the final WebView selection event, prevents editor/preview feedback loops, remounts the required virtual-preview range, and reapplies the highlight whenever virtual preview nodes are replaced. `src/sync/selection-mapping.js` projects rendered characters back to their exact Markdown source boundaries for headings, lists, inline formatting, links, tables, highlighted code, images, and KaTeX. Cross-block editor selections are rendered as multiple CSS Highlight ranges rather than whole-block approximations, while preview selections map their two DOM boundary points directly to source offsets. A bounded nearby-text search remains only as a compatibility fallback when an unsupported extension cannot be projected.
