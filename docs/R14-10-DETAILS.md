# R14-10 HTML Exporter

状态：**实施完成，待本提交 Windows 累计验收**；14.10不勾选，14.11未开始。继续唯一分支 `agent/r14-stage`，基线为09正式验收提交 `637091b835226248070ace536b99062dd74d2c86` / [CI38107902440](https://github.com/uniquenesssta/mdr/actions/runs/38107902440)。

## 09收尾

09七组和所有执行步骤成功，全仓1878/1878（335文件16目录）、前端873/873、Markdown30/30、原导出/请求/任务/取消/进度43/31/16/22/20、Builder21、增强27、Styles21、安全6、Settings5、浏览器11/11＋48/48、Rust281和真实Windows导入8/8通过。四份归档SHA-256与提交一致，最终accepted=true。0/76/690000 UTF-8原文、所选非当前文档保存标题映射、当前模型保持和写前过时零输出均有实际证据；首轮失败与修复完整保留。[09正式验收](R14-09-DETAILS.md#正式验收2026-10-11)。

## HTML唯一所有者与完整文件

`createHtmlExporter`从Export公共入口导出，main注入公共模型、Documents、Builder、Enhancer、任务控制器、字体资源、序列化器与Platform。菜单/工具栏仍调用`exportHTML()`，该经典函数仅创建不可变Request、委托owner和通知。旧HTML正文编排、模板、CDN/auto-render脚本和直接Blob下载均删除；Word/PDF/Image后续迁移不在本项提前实施。

| 职责 | 当前唯一所有者 |
| --- | --- |
| 当前完整正文与原始来源身份/版本 | 已验收公共Document Builder；同步Worker块分批复用、必要时显式快照 |
| 代码、任务列表、数学与Mermaid | 已验收公共Preview Enhancer；生成可独立显示的完整DOM/SVG |
| 版式与可访问数学 | 已验收公共Export Styles的HTML profile，原CSS完整不变 |
| 锁定字体资源 | `document/html-font-assets.js`；注入按需加载的WOFF2数据URL并复用原@font-face描述 |
| 独立HTML语法 | `document/html-document.js`；DOCTYPE、zh-CN、UTF-8、viewport、完整title转义、共享CSS/字体和完整正文 |
| 工作流和输出屏障 | `formats/html-exporter.js`；唯一任务、代次/版本/来源身份、不可取消写入与等待销毁 |
| 文件输出 | 既有Platform保存对话框、安全writeText或浏览器Blob/URL清理；不重建文件替换算法 |
| 临时经典命令桥 | `classic-html-export-port.js`；非枚举冻结命令、独立幂等卸载，不销毁owner/共享能力 |

HTML不会再加载KaTeX CDN或运行应用私有`exportPresentationPort`/auto-render脚本。数学与图表已在导出前完成，不要求打开文件的浏览器再渲染原文；可访问MathML保留，图表为原完整SVG。HTML标题移除正确.html/.htm后缀后对&、尖括号、引号和单引号逐项转义；正文沿用Builder安全物化与Enhancer受控输出，不进行另一轮丢失公式/SVG的净化。

14.2的全部原始名称夹具及对应HTML映射、扩展过滤器、自定义目录保持；元数据在首次异步等待前复制并冻结。HTML仅处理当前文档，非当前身份在任务前拒绝；文档右键原文导出仍由09负责，不为了HTML导出切换文档。

## 离线资源与包体积

项目锁定Vite7.3.6、KaTeX0.18.2，生产依赖/锁文件不改。组合根使用项目既有父目录依赖布局的`import.meta.glob('../../node_modules/katex/dist/fonts/*.woff2', {query:'?inline',import:'default'})`注入异步loader。`?inline`强制二进制字体为数据URL，与assetsInlineLimit无关。Vite仅将这些字体归入独立`katex-export-fonts`异步包，原katex-vendor和500000/700000字节门槛保持；不把完整字体包加到初始应用包。

资源owner加载后按原CSS逐一匹配所有WOFF2 font-face，将src替换为对应数据URL；缺失、重复、远程/非WOFF2或不安全资源明确失败，不输出缺字体文件。资源输入脱离调用方，成功的不可变CSS按owner复用；初次加载失败可以在后续新任务重试。共享Styles仍拥有唯一数学布局与HTML profile，不复制或改写其CSS权威，也不改变Preview/Hybrid/Image样式。

离线承诺覆盖应用模板、数学字体和已完成的图表输出。用户正文链接与自行引用的外链/本地图片保留原URL，不增加抓取、权限或自动离线缓存政策；超链接可由用户打开。本项不宣称所有用户外部内容已离线缓存。

## 取消、过时和生命周期

HTML owner在请求合法、记录存在及身份为当前文档后才开始唯一任务。捕获原Documents generation、活动身份和模型版本；检查Builder来源身份/版本，构建、增强、字体导入、序列化、保存对话框与写入前后均核对。进度监听器同步修改内容或销毁也不能发布旧文件。

构建/增强/资源/保存等待同时消费公共取消token及owner独立销毁信号；取消/替换/销毁立即结束该任务，迟到失败被观察，不产生迟到下载或通知，不清掉替代任务。writeText前锁定writing，新任务与取消均不可撤销已发出的写入；销毁/修改发生在已发出平台安全写入期间只能拒绝晚到结果，不承诺撤销文件、不重试。

main在pagehide及Document feature清理中先释放HTML owner与命令端口，再清理任务和公共依赖；清理循环逐项执行。字体资源缓存没有DOM/模型/文件所有权，迟到导入仍由异步操作完成，由外层任务/销毁屏障阻止发布。格式桥随后续删除经典调用者一起退休。

## 验证映射

新增36项HTML契约：资源完整/失败重试、错误资源拒绝、被动模板/全title转义、两平台空/Unicode/大正文、全部原名称/目录、任务前拒绝、Builder来源、构建/增强/字体/对话框四阶段×取消/替换/销毁、四种来源变化、同步进度重入、picker取消/非法返回/不完整平台能力、各层原异常身份、写入锁定、写中销毁、桥接与实际经典入口、独立字体chunk/原预算保持。

VM实际挂载公共HTML owner/serializer/assets＋原Builder/Enhancer/Styles，浏览器输出复用真实既有downloader；只以平台/DOM/vendor替身核对编排，实际版式/渲染/字体由Windows built-app证明。原43项格式、31项请求、30项Markdown及所有已验收场景保持。仅把F02两处“必须有CDN/应用私有引用”的缺陷基线断言映射为“无脚本/CDN/私有引用且有内嵌字体”；14.1原始夹具不改写。08共享CSS断言保持原样。

原48个built-app场景保留，新增3项为51：

1. 实际生成原始完整HTML、不删除脚本/链接或重建文档；全部HTTP/HTTPS请求被既有CDP Fetch能力阻断期间在独立Blob页面加载，严格验证20项字体均加载、两公式及MathML、SVG/任务/代码、无私有全局/脚本/网络请求；先以失败请求正控严格证明HTTP阻断生效。归档原HTML、实际独立页面截图和JSON；finally移除frame、撤销URL并卸载HTTP拦截。
2. 空文档、中文/emoji和超过400000字符的完整正文实际HTML文件，正文完整、MIME/20项字体/无脚本、URL清理、Preview原节点身份、作用域端口及任务释放。
3. 实际任务的serializing进度回调改变模型，第一次零文件、第二次仅当前新正文；最终pagehide增加HTML命令拒绝与属性卸载。

工作流增加html-exporter.log，保留七组Windows、原累计门禁、真实WebView安全/导入链及十八项安全写入。新36项及51项页面仅交新精确head Windows验证；没有运行本地产品Node测试、浏览器、构建或Rust。

## 接收与静态复核

本项实现F02模板的CDN/私有运行时修复和F03的HTML格式输出，关闭与否以本提交独立页面和名称/文件证据通过为准。14.11 Word完整格式/字体、14.12打印隔离、14.16图片资源与14.17统一格式File Writer保持；整体A10与独立Editor指标问题不在本项提前关闭。R12历史根记录和此前验收/失败历史保留。

Context7核对Vite7官方资产?inline和glob异步/default语义，结合父目录依赖策略与实际配置；Mermaid Chart显示真实中文Builder/Enhancer/Styles/字体/序列化/任务/平台链。Actions启动后结束，不轮询，约15～20分钟后查询。静态最终结果补下方。

最终静态复核：四项门禁通过；12份新增/修改脚本语法、29个实际页面嵌入表达式、5段CSS与6个本地令牌通过。JSON/YAML、140个相对链接、59项风险源指纹通过；9个冻结文件及169个其他受保护文件字节保持，531模块清单原527行完整保留。R12根历史/阶段历史前缀、09首轮失败与修复保持；diff复核通过。36项HTML契约与51项built-app定义均未在本地执行，只交Windows新精确head验收。
