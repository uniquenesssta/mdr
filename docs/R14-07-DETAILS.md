# R14-07 Preview Enhancer

状态：**首轮未通过；宏污染测试断言修复待精确提交 Windows 重验**。继续 `agent/r14-stage`，基线 `f8d2312534e0487868a9cba034e882ba78318dce`。14.7不勾选，14.8未开始。

## 06收尾证据

06正式实现验收保持 `1f49956` / [CI37958151064](https://github.com/uniquenesssta/mdr/actions/runs/37958151064)：七组及全部步骤通过，全仓1781/1781、前端776/776、Builder20/20、Settings5/5、导出43/43、浏览器11/11＋39/39。三次失败及对应修复保留。文档收尾 `f8d2312` / [CI37961049857](https://github.com/uniquenesssta/mdr/actions/runs/37961049857) 的精确head、七个job及全部执行步骤本轮核对成功，不替代正式实现验收。用户随后要求“收尾06开始07”。


## 首轮失败证据与测试修复（2026-10-10）

`a8b830283e7cff1328472c65a4518db5552358ac` / [CI37967189292](https://github.com/uniquenesssta/mdr/actions/runs/37967189292)，attempt1：已核对精确head、全部job与步骤、前端/全仓Node/最终汇总日志。增强27/27、Builder21/21、Settings5/5、导出/请求/任务/取消/进度43/31/16/22/20；浏览器契约11/11、built-app42/42与生产构建成功。Rust、原生、WebView和依赖四组成功；安全5/6、前端809/810、332文件16目录的全仓1814/1815未通过，最终汇总正确拒绝。

唯一直接失败是安全测试第5项：对原型继承的\pollutedMacro，实际引擎已经抛ParseError，错误为“No function handler for \pollutedMacro”；测试要求“Undefined control sequence”，导致专项、前端和全仓重复报告同一断言。官方0.18.2的 [Namespace.ts](https://github.com/KaTeX/KaTeX/blob/v0.18.2/src/Namespace.ts) 确实只接受自有宏；[Parser.ts](https://github.com/KaTeX/KaTeX/blob/v0.18.2/src/Parser.ts) 在读取该继承名字时可转到函数解析并抛另一条ParseError，[katex.ts](https://github.com/KaTeX/KaTeX/blob/v0.18.2/katex.ts) 公开同一ParseError类。拒绝污染宏才是原安全契约，固定诊断文本没有公共保证。

只修改原第5项测试：继承值使用可观察文本宏POLLUTEDTOKEN，要求真实katex.ParseError且关联原命令；throwOnError=false仍须返回错误标记、不输出污染内容；显式自有宏OWNMACRO须正常渲染，证明没有把所有宏禁用。finally恢复原属性描述符保持，六项场景全保留。其他公式/信任/元数据安全用例、增强27项和42项实际页面用例保持，生产代码、依赖、工作流与全部49项风险源指纹不变。不是忽略异常、放宽类型或将缺陷基线标为成功。

已下载并校验前端artifact11633977819（SHA-256 c7f866e840b8be9359346ffb012424f30fe6c686987f1f3caef22c73bdfbea28）与全仓artifact11633683077（3496aa5c88bdb97a1c32b4bae8f311c472de078fb328498559a370ffe03b67d0）。18份实际文本产物中的12份HTML/Word各有2个KaTeX、1个SVG、1项任务列表和4个代码token，无原始图表/复制按钮；打印调用1次且增强正文含2个公式/1张图、afterprint视图恢复、错误为空。真实PNG为126235字节、1080×2563，签名与尺寸核对；40段增强首批取消/释放后重建得到40个数学节点，旧正文编辑后保持未改变并拒绝document-changed，公共math继承trust探针无链接且普通块公式成功。这些实际证据不覆盖唯一安全断言失败，也不等同07正式验收。

另已查看实际PNG：公式旁出现额外x2/21文本，疑似MathML辅助内容可见；具体样式原因待查，已在14.8/14.16登记共享样式与实际图片视觉回归。这里的解码/内容链成功不代表公式布局完整。完整离线格式、打印隔离、图片释放和独立Editor指标项仍保留原接收范围，不在本次测试修复关闭。

Context7核对renderToString/ParseError/错误HTML契约，并与官方0.18.2源码核对；仅改一项测试和证据记录，无产品架构变化，不新增Mermaid Chart调用。本地四项静态门禁、1个脚本语法、111个相对链接、49项源指纹及9个冻结文件、原始夹具与历史保持检查通过；只有原安全测试第5项改动，产品/依赖/工作流/页面测试字节保持。未运行本地产品测试，产品验证继续交同分支新Windows CI；14.7仍不勾选，14.8未开始，A10补丁验收与后续完整格式门槛不豁免。

## 公共职责与完整调用链

新增 `src/features/export/document/export-preview-enhancer.js` 与作用域 `classic-export-enhancement-port.js`，由Export公共入口导出、main装配。增强器只拥有当前增强作业、每个正文的当前所有者、临时Mermaid容器及待执行帧；任务/取消状态仍由原Task Controller独占，文档与共享渲染器仍由既有所有者管理。没有复活退休全局变量或复制模型/Worker状态。

Builder新增私有WeakMap来源记录与只读 `getSourceContext(body)`，保存构建开始时的文档ID与版本。增强器必须消费同一Builder产生的正文，拒绝未知正文与请求身份不符；即使模型随后更新，旧正文来源不会被当前版本覆盖。不把这些元数据写入可导出的DOM属性，不增加全文快照。

| 格式入口 | 本项新行为 | 后续职责 |
| --- | --- | --- |
| HTML/Word | build完整正文→enhance→序列化增强后的innerHTML→原文件边界 | 14.8统一样式、14.10/14.11独立离线完整格式 |
| PDF | 完整正文先离屏增强，再挂到打印Preview并进入原不可取消打印交接 | 14.12打印隔离、恢复与计时器寿命 |
| Image | 在原暂存容器内增强完整Builder正文，再准备图片和实际PNG编码 | 14.13～14.16布局、资产、编码及完整释放 |

旧 `enhanceFullPreviewForExport` 整段删除，四种格式统一使用新端口；经典导出器对 `styleTaskLists`、`renderMermaidBlocks`、`observedPreviewBody` 的退休引用删除。作用域端口只委托冻结的增强能力，幂等卸载自身，不销毁共享依赖；后续14.17删除经典导出器时一并撤销迁移端口。

每18个顶层正文节点为一批，保持全部正文顺序，不按虚拟窗口截断。调用Preview公共Task List Renderer为复选列表加类；代码调用公共 `renderHighlightedCodeRows` 保留源码换行，处理顶层pre和嵌套代码，不创建编辑器复制按钮或监听器。数学使用公共math.renderTree、现有分隔符及显式trust=false。Mermaid语言按共享规范化能力识别，包括大小写标记；公共renderDiagram消费当前主题、版本化缓存键及取消谓词，成功后才替换原pre。

## 异步、版本与销毁

- 每批、每节点及每个异步结果后重新检查原文档身份/版本、只读token、正文所有者和销毁状态。文档变化抛原 `ExportDocumentStaleError`，不返回部分正文或混用两个版本。
- Mermaid先渲染到临时容器；迟到结果还须满足原pre仍在正文、代码源码未变化。取消、替换、销毁及过时结果均不能替换正文；迟到库拒绝被已有Promise观察，避免未处理拒绝。
- 批间帧和图表等待消费既有token；独立作业停止信号还可中断无task等待。同一正文的新增强替换旧等待，不形成两份任务权威状态。finally释放帧、作业与Task List Renderer。
- main的正常dispose/pagehide逐项清理先中断增强器、卸载增强端口，再释放Builder、Preview和模型；一项清理异常不阻止其他已登记释放。PNG编码与系统打印的不可取消边界保持。

## A10独立兼容安全补丁决策

本项必须在14.7验收前处置已接收的KaTeX/Mermaid传递low公告。[官方公告GHSA-238p-pmpm-9mq7](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7) 和 [0.18.2发布记录](https://github.com/KaTeX/KaTeX/releases/tag/v0.18.2) 指定已修复版本0.18.2。风险是既有原型污染影响信任和配置读取；KaTeX本身并非污染写入源。只设置trust=false不能证明引擎已修复。

按 [全局§0.9](markdown-main-full-rewrite-taskbook-18-docs/01-全局架构规划与基线冻结.md) 定向固定直接KaTeX为0.18.2，添加 `overrides.katex="$katex"` 使Mermaid传递路径使用同一版本。旧锁定0.16.47→0.18.2；这是0.x兼容补丁决策，仍须实际回归，不假定次版本天然兼容。未使用audit fix --force，未更新Mermaid11.16.1或其他锁包。

已结合Context7与官方0.18.2包元数据核对默认导出、contrib/auto-render子路径、render/renderToString及选项，Commander仍为^8.3.0；支持平台、Node范围、Rust MSRV、Rust依赖与存储格式不变。公共math包装还限定只有自有trust===true才启用信任，拒绝从原型继承的trust。既有合法显式选项与未信任渲染仍保留。

锁文件元数据审计为零公告；这仅证明当前依赖解析，不代表Windows产品通过。新增真实KaTeX引擎对继承trust、default/processor、宏命名空间污染及普通公式/错误的回归，并在实际页面验证公共包装、数学/Mermaid导出。Windows还必须通过既有Preview/Hybrid、构建、原生、WebView及全部累计门禁。A10补丁待本提交验收，最终关闭仍要求14.10/14.11/14.12/14.16完整离线链；R12历史验收与旧公告快照不改写。

## 旧断言映射与证据边界

原 `contracts.json`、`requests.json` 字节保持。43/31/16/22/20导出、请求、任务、取消、进度场景均保留，Builder20项保留并追加来源上下文为21项，Settings5项保持。

| 原覆盖目的 | 本项映射 | 保留边界 |
| --- | --- | --- |
| 退休增强接口导致实际PDF/Image失败 | 实际公开链得到增强打印正文和可解码PNG，退休名须不存在 | 仍检测错误、任务/进度结束、视图恢复、不可取消编码和文件边界；打印只截获系统交接，PNG调用真实锁定库 |
| HTML/Word原文、MIME、名称与下载 | 同一18份实际文本产物须含KaTeX、代码token、任务列表及标准SVG，无原始Mermaid/code-copy按钮 | 原名称/字节/URL释放及所有6组输入保持；独立模板缺陷F02仍记录 |
| VM原PDF时序与取消 | VM执行真实Builder和Enhancer，改从公共增强调用可控库等待，不提供退休绑定 | 替身只证明编排，不能证明KaTeX/SVG/PNG或系统打印结果 |
| 旧数学调用源码边界 | 四种调用者均用公共增强端口；增强器调用math.renderTree并禁止旧函数/变量 | 公共代码、数学、图表的实际引擎/页面回归另执行 |

新增27项增强契约：完整40节点18/36/40批次、空/未知正文、顶层代码、大小写图表、身份/版本/请求失效、帧和图表中的取消/替换/销毁、无task独立销毁、源码变化/节点移除、同正文替换、库失败后重试、进度订阅取消、桥接和必要能力。新增6项真实引擎安全、1项Builder来源场景。

原39个built-app场景保留并映射成功行为，新增实际批次取消后重新完整增强、编辑导致旧正文失效、公共math拒绝继承trust三项，共42项。打印/图片探针归档正文数量、主题/视图、阶段与实际PNG；暂存节点仍按现有Image逻辑保留1个，仅尺寸样式释放，完整节点释放属于后续14.16。现有长文137段、无全文快照、Worker批次、主题身份、pagehide和真实Windows导入链门槛保持。

当前不宣称HTML离线可携带、Word样式完整、系统PDF已生成、打印计时器竞态已解决或图片资产/容器寿命全部完成。F02中的旧CDN与应用内变量引用仍由14.10接收；共享样式14.8未开始。独立Editor指标错误 `scheduleEditorMetricsRebuild is not defined` 保持原开放记录，不在本项关闭。

## 首轮实施静态自检

四项架构/退休运行时/生成文件/README静态门禁通过；16个改动JavaScript脚本和16个实际页面嵌入表达式语法通过；JSON/YAML、111个相对链接、49项源指纹、9个冻结文件（8个JS模型加Rust文档存储）、两份原始夹具、Cargo锁、历史验收与全部失败/修复记录保持检查通过。锁文件包差异仅根KaTeX要求与node_modules/katex条目。产品Node、浏览器、构建、Rust和安全引擎测试只交本提交Windows CI；本环境不运行这些产品测试。当前累积风险源从47增至49，两项新增源加入，改动源的旧指纹保存在本项实施记录。冻结模型、原始夹具及R12/历次阶段验收、失败与修复历史须复核保持。

Context7已查询真实KaTeX/Mermaid API及安全选项，并与锁定版本的官方发布/包元数据核对；Mermaid Chart已显示实际中文Builder→公共增强→四格式、取消/版本及pagehide关系。CI追加export-enhancement.log与renderer-security.log，不减少既有七组或失败退出门槛。启动后按AGENTS规定结束会话，不轮询，约15～20分钟后查询。
