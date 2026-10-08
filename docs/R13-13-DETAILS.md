# R13.13 导入到文档链

状态：**完整导入链的真实 Windows WebView 已通过；首轮累计回归未完全通过，本轮修补测试迁移遗漏，待新提交 Windows 验收**。

用户于 2026-10-08 授权“开始13.13”。沿用唯一阶段分支 `agent/r13-stage`，本轮基线 `59b0ba25b56134a804fc1caa6da078e147230bf8`，初始工作区干净。R13.12 的功能验收基于 `fabf0873269a220b88c58684d8196e996eb7926b` / [Windows CI 36971353716](https://github.com/uniquenesssta/mdr/actions/runs/36971353716) 七组通过；后续文档收尾 CI 的当前依赖门禁曾失败。前置补丁 `927988119d3a4637b084eddeb032503d313363e1` / [Windows CI 37651965466](https://github.com/uniquenesssta/mdr/actions/runs/37651965466) 七组均成功，已依原启动授权续接完整导入链。用户本轮要求“收尾13”，按 R13.13 收尾实施；没有推进 R13.14 或宣布 R13 整体完成。

## 首轮累计回归失败与本轮修复（2026-10-08）

`92242e611793f4caee2ae42c0b3947c39fd7829e` / [Windows CI 37660954894](https://github.com/uniquenesssta/mdr/actions/runs/37660954894) 已结束：真实 Windows WebView 导入链与原有安全回归、Rust、原生编译链接、依赖四个 job 成功；全仓 Node 和前端 job 失败，最终汇总按原门禁拒绝验收。前端生产构建、built-app 浏览器回归、审计和四项静态门禁均成功。

完整失败日志确认14个具名断言仍固定于已迁移的 classic 入口或旧事件数量，另有 `create-platform.test.mjs` 静态导入已删除的 `mountClassicDropImportPort`，使该文件无法加载。不存在以成功 job 替代失败 job 的准入。以下对应关系补齐首轮漏项；本轮没有修改产品源码、模型、锁文件、历史夹具、工作流或验收脚本。

| 失败测试与原目的 | 当前接口/行为断言 | 保留场景 |
| --- | --- | --- |
| architecture/stage-05-legacy-path-removal：剪藏只修改唯一模型 | classic 打开委托→Import 插入→Editor Controller→model.replaceRange | 空白替换、正文末尾两换行追加、单次事务；原 Editor 行为回归仍执行 |
| architecture/stage-06-recent-files-menu 与 unit/documents/recent-files-repository：Documents 独占最近文件持久化，仅成功登记 | Import 在 UI 完成、意图和 Documents 代次检查后调用注入回调；main 注入现有 repository.add | 仓库存储/订阅、Menu 只读、读取/保存失败、取消/过期结果不登记，冻结模型 fingerprint |
| stage-01-handoff：历史事实与当前精确迁移清单 | 当前 inline events 为34，另检查移除的 input change/file-menu handler 不存在；历史67/9/38保持 | 实际生产清单、无新增全局、架构扫描与历史交接 |
| stage-10-remove-legacy-save：导入准备不复制保存权威 | Import 准备先于 Documents.openExternalDocument；main 注入 autosave.cancelPending，export 无导入实现 | Export/Save/Autosave 边界、保存前后顺序及错误保护 |
| stage-13-drop-overlay/file-type-classifier/image-policy：单一分类与策略及生命周期 | main 的 owned Drop callbacks、Import reader 调用、实际 destroy 路径 | 文本优先、原生扩展、MIME与大小/确认阈值、overlay 与晚到回调清理 |
| unit/platform/create-platform：执行生产装配而非复制选项 | VM 执行 main 实际 reader/controller 装配和当前 start 回调，使用公开 Import controller | browser/desktop 文本和图片读取、原生/DOM去重、unsupported/error 不误触发、订阅清理、terminal 错误；原 Platform 其余测试恢复加载 |
| unit/platform/dialog-client/drag-drop-client/file-system-client/platform-cutover：平台仅运输、业务归应用层 | main 注入 Dialogs/Files/DragDrop，Drop→Import→File/Image readers；classic clipper 使用 scoped Document UI port | dialog 参数与原生错误、normalized events、文字/图片扩展差异、DTO/MIME解码边界、无 native 全局替代门面 |

本轮重新检索相关测试中的旧导出/接线引用；未删除测试用例、未新增 skip、未忽略失败退出码。现有 Import/真实 Documents 回归与八类真实 WebView 证据继续执行。平台装配测试仅提供隔离端口的单元验证，不能代替已要求的真实原生文件/HTTP/WebView链。Mermaid Chart 按当前公开调用链更新回归覆盖图；本轮没有新增第三方或系统接口。

本轮四项静态门禁、13个变更脚本语法、99个文档相对链接、37项当前风险源blob与差异检查通过，历史acceptance及生产源码保持不变；不执行 Linux/macOS 产品测试或构建。新的全部行为/累计验证仍交由本提交 Windows CI。13.13、A03/A05完整验收继续未勾选，13.14未推进，KaTeX新low风险的处置条件保持。

## 前置失败与定向修补

`59b0ba2` / [CI 37606184822](https://github.com/uniquenesssta/mdr/actions/runs/37606184822) 的唯一直接失败是 `npm audit --audit-level=high`。全部 Node、架构、浏览器、生产构建、Rust、原生及真实 WebView 检查成功；最终证据汇总因前端 job 失败而拒绝准入。失败来自新增公告，不能当作可以忽略的旧断言或文档变化。

| 依赖 | 锁定版本变化 | 官方依据与范围 |
| --- | --- | --- |
| source-map-js | 1.2.1 → 1.2.2 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)、[官方发布](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)：修补 indexed source map offset 引发的事件循环拒绝服务。仍为 PostCSS 的开发传递依赖；Node 最低版本声明未变，BSD-3-Clause 许可证未变。 |
| DOMPurify | 3.4.13 → 3.4.16 | [官方发布](https://github.com/cure53/DOMPurify/releases/tag/3.4.16)：修补 IN_PLACE 的 hooks 移除节点与 raw-text 根节点问题。现行应用使用 string 输入和 RETURN_DOM_FRAGMENT，不使用 IN_PLACE；公共净化策略、标签/属性及 URL 判定保持。许可证仍为 MPL-2.0 或 Apache-2.0。 |

仅更新现有依赖和对应锁文件条目；未新增依赖、未升级跨主版本、未修改模型、存储格式、抓取策略或产品源码。当前门禁仍为 `--audit-level=high`，未增加忽略项、跳过或放宽条件。

公告和对应发布已从官方来源核对。Context7 核对 RETURN_DOM_FRAGMENT 与 allow-list 公共接口；其 main 文档不是精确补丁兼容证明，因此 3.4.16 的实际兼容性仍交给当前 Windows 浏览器、真实 WebView 和完整回归验证。

## 已完成与待完成验证

- 本地 `npm audit --package-lock-only --audit-level=high --json` 返回 0；报告 high=0、critical=0、moderate=0、low=2。仅为当前锁文件公告扫描，不能代替真实安装或 Windows 产品回归。
- 锁文件差异仅涉及 DOMPurify、source-map-js 及根依赖版本；下载完整性与 npm 发布元数据一致。
- `verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record`、文档链接和 `git diff --check` 静态自检通过。首次架构自检因依赖未安装失败，使用既有 `deps:prepare` 在仓库上一级安装锁定依赖后重验通过，未修改检查规则。不执行 Linux/macOS 产品测试或构建。
- Windows 沿用既有七组累计 CI，包括真实安装审计、完整 Node、浏览器、生产构建、真实 WebView、Rust/Clippy/check、原生编译链接与同提交证据汇总；前置补丁在 CI 37651965466 已全部通过；下方新增业务链及测试仍需本提交的新 Windows 证据。

剩余 low 项为 [KaTeX GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) 及其 Mermaid 传递影响；当前 KaTeX 0.16.47，官方修补版本 0.18.2，超出现行 ^0.16.25 范围。它要求已存在的原型污染，不能仅凭当前代码设置 trust 就声明风险已关闭。本轮不自动跨兼容范围升级或豁免；R13.13 全链路安全与 A10 复核时须继续评估污染来源、渲染选项/HTML 边界及升级兼容性，未处置前不得宣称该公告已修复。

## 本轮完整链路

新增 `ImportDocumentController`，由组合根注入公开 File/Image readers、Documents 生命周期与 Editor 命令。它拥有导入意图代次、AbortSignal 和成功通知；记录、正文、保存和最近文件分别仍由 Documents、Editor 与既有仓库持有。没有建立第二份文档状态。

- 文本文件经过准备转换、保存当前文档、懒读取、CRLF 长度校验、Documents 激活、UI 更新后登记最近文件。保存失败不启动读取，读取失败不建档，成功的空文本仍可创建空文件文档。长度校验保留原规则，使用计数而非额外复制整份正文。
- File reader 接收外部取消信号。Documents 在保存后、读取后、激活前复核取消；新的导入、插入或销毁拒绝旧结果。图片读取还复核 Documents 代次，避免读完后写入后来切换的文档。
- 图片通过公开 Editor 图片命令在当前选区插入。网页成功转换后通过 Editor Controller 进行一次替换或追加：空白正文被替换，已有正文末尾追加两个换行。统一事务流继续驱动 Preview、Hybrid、懒建档及自动保存。
- 文件 input/change、原生 picker、拖放、最近文件、Folder Tree 和启动路径均进入公开导入命令。经典脚本只保留通用文档 UI 更新、Find/Preview、Toast 及网页菜单打开委托，没有来源读取或文档插入实现。
- 删除 `classic-file-import-port.js`、`classic-drop-import-port.js`、`handleNativeDroppedPath`、`triggerImportFile`、经典 `loadFile/loadDocumentFromContentLoader/loadTextContentAsDocument/importFile` 及对应挂载、销毁和性能包装。E2E bridge 通过 `importTextContent` 使用同一应用链；文件 input 的内联 change 与旧打开文件 handler 也已移除。
- Import 的销毁从 pagehide、文档功能销毁和启动失败进入同一幂等生命周期。它释放自身视图、注册与导入操作；平台 reader 的终止仍由组合根负责。

R13.14 仍负责未在本项自然移除的历史模块（包括未挂载的 web/extractor/converter/clipper ports）、剩余经典打开委托与内联 modal 清理；本轮不勾选13.14。

## Windows 完整链证据

扩展既有 Windows WebView harness，同一隔离宿主加载本提交的真实生产 dist，并通过真实原生 IPC、Rust fetch command、HTTP transport、响应边界与自有 HTTP 服务抓取 HTML。宿主准备脚本仅在归档副本中注入一个 `r13-import.test` 的私有 DNS resolver，限定显式 HTTP 和随机自有端口；生产源码、网络策略和所有其他域名解析保持不变。这个测试不代替公网 DNS/私网拒绝等已有 Rust HTTP/HTTPS 门禁。

实际 UI 触发“抓取→提取/转换→懒建档→Preview/Hybrid”，核对只插入一次及合法 Markdown、数学、Mermaid。网页图片仍按已验收提取策略移除；图片与原始 HTML 正常/恶意混合内容通过真实原生文件读取→Documents→Preview/Hybrid 验证。无害事件、URL、IPC、clobbering/CSS 标记不得执行、导航或发起 CSS 请求。

同一 WebView 还检查非 HTML 响应不建空档、取消后晚到响应不能插入、原生读取失败保留当前文档、成功后才登记最近文件。原有五类 HTML sink、独立 CSP 控制、真实 canary IPC、正常内容与锁文件保护回归全部保留。

新增同提交证据准入：八类完整链场景必须齐全、成功且引用当前 SHA；沿用真实 WebView/CSP/IPC 条件。缺失、旧提交、mock、取消/失败场景失败、图片丢失或 IPC 尝试都会阻断最终累计验收。既有 R12 历史验收快照和历史测试夹具没有改写。

直接依赖锁定 reqwest0.12.28（另有传递0.13.3）。Context7 查询0.12系列地址覆盖与no_proxy行为，随后按[官方0.12.28接口文档](https://docs.rs/reqwest/0.12.28/reqwest/struct.ClientBuilder.html)核对显式URL端口与地址覆盖，并结合现有 `fetch_with_resolver` 私有边界使用；Context7目录0.12.9不能代替当前版本验证，真实宿主构建仍由Windows执行。Mermaid Chart 已生成本轮真实业务调用链图。

## 旧断言迁移对应

| 原断言目的 | 新接口/行为断言 | 保留场景 |
| --- | --- | --- |
| classic File port 的唯一所有者、终止与 browser/native 接线 | File reader 外部取消、Import controller 幂等销毁、公开 reader→Documents 接线；文件已删除且不在生产清单 | 相同文本 DTO、空文本、严格结果类型、读取错误、替换/取消/销毁及建档前保护 |
| classic Drop port 的激活、重复挂载和终止 | Drop controller 的单次 start、终止及公开 openImportPath；真实 Import callbacks 替代 VM 经典片段 | 文本优先/MIME、扩展名、尺寸、首项、空/多项、native/DOM 去重、迟到 disposer、错误、取消及最近文件 |
| classic clipper start/open 表示唯一抓取/提取 owner | main 注入唯一提取/转换与 Import 插入，经典打开委托调用 openWebClipper | 手动/抓取、错误恢复、改输入/关闭/销毁拒绝迟到 HTML、重复插入及已有 browser/WebView 场景 |
| E2E 通过全局 loadTextContentAsDocument 走真实文档生命周期 | E2E 调用公开 importTextContent，同一 Import→Documents 链 | 不直接载入 VirtualEditor、不手工伪造 input；既有 built-app browser 回归仍执行 |
| 旧源码字串和固定桥接销毁次数 | 精确生产清单、实际新生命周期以及取消/失败行为 | 旧算法/数据契约、历史 R12 fingerprints、全套 Node/原生及真实浏览器验证继续保留 |

架构 baseline 只移除两个已迁移的内联事件并更新当前位置；真实 business global 写入集合未增加，R12-18 的历史 scanner 修正说明保留。当前风险源清单增加新协调器、关键公开接口与隔离宿主/证据代码，按真实 blob 更新；历史 acceptance 内嵌 fingerprints 保持原值。

## KaTeX 新公告复核边界

当前导入输入作为字符串/脱离 DOM 的节点处理；这条链未发现将不可信键递归合并到渲染选项或 `Object.prototype` 的操作。净化策略限制名称、类、URL 与 CSS，并有真实 clobbering/CSP/IPC 回归。这里仅说明本项输入边界，不能证明全部依赖没有原型污染来源。

现行 Math presentation 使用普通 options 对象，KaTeX 0.16.47 内部 `applySetting/getDefaultValue` 仍读取普通属性，Mermaid 也传递依赖同版本；输出增强后没有另加一次能完整保留数学/SVG 的净化层。因此不能用显式 trust=false 或本项净化结果声称公告已修复。修补0.18.2超出既有0.16兼容范围，自动升级和全局删除原型属性都未采用。两项 low 保持新风险，须在 R13 阶段安全收官前作兼容升级或完整处置决策并完成真实数学/Mermaid 回归；A10 历史 R12 验收不覆盖此新公告。

## 首轮实现的静态验证与准入状态

首轮实现时本地四项静态门禁、29个变更脚本语法、82个文档相对链接、37项当前风险源blob及差异检查通过，历史acceptance快照保持原值；不在Linux/macOS执行产品测试或构建。新增行为、真实 HTTP/文件读写、WebView、生产构建及累计回归交给同分支 Windows CI。

本项实现可提交，但13.13复选框和A03/A05本阶段全链验收继续未勾选，必须待新提交的七组Windows CI和八类链证据全部通过再收尾。前置成功不代替本项证据。推送启动CI后按用户要求结束会话，不轮询；约15～20分钟后查询。

本轮不改变模型算法、存储格式或生产抓取策略；回退本轮业务提交可恢复此前调用链，保留已通过的前置依赖补丁。无数据迁移。
