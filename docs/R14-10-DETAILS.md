# R14-10 HTML Exporter

状态：**已正式验收收尾**；修复提交`00930e00114a921f89a7d37ac3b3fb159ed20778` / [CI38135455053](https://github.com/uniquenesssta/mdr/actions/runs/38135455053) 七组与所有步骤通过；14.10勾选，按用户指令开始14.11。继续唯一分支 `agent/r14-stage`，基线为09正式验收提交 `637091b835226248070ace536b99062dd74d2c86` / [CI38107902440](https://github.com/uniquenesssta/mdr/actions/runs/38107902440)。

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

## 首轮失败与修复（2026-10-11）

精确提交`40349cbf5e2cd23916ddf0091094fb719f8ab0dc` / [Windows CI38110755648](https://github.com/uniquenesssta/mdr/actions/runs/38110755648)，attempt1完成失败。HTML契约32/36、前端905/909、全仓1910/1914（336文件16目录）、浏览器契约11/11、实际页面49/51；Rust/安全写入、原生链接、官方依赖图与真实WebView四组成功。前端和全仓两组失败，最终汇总以`Browser evidence failed: browser-app.log`正确拒绝，不能用独立离线场景成功代替完整验收。

| 失败链 | 日志与真实契约 | 当前修复 |
| --- | --- | --- |
| build/enhance/assets/save四阶段主动取消 | 测试期望reason=user；已验收公共Task Controller设置phase/reason=cancelled，原22项取消契约保持 | 明确assert cancel返回true，随后严格确认ExportCancelledError及reason=cancelled，保留零写入、任务归属和迟到失败观察 |
| 空/Unicode/大正文与过时零输出后重试两项页面 | TypeError读取null.textContent；生成文件使用body.export-document，Builder内层内容不包含markdown-body根 | 使用DOMParser结果的doc.body，并严格检查.export-document[data-export-format="html"]；保留完整正文、450000+字符、首次零输出/下一次正确正文、MIME、20字体、Preview身份、任务/URL释放 |

断网独立HTML场景已通过：未经重写的399663字节原文件、HTTP失败正控、20项WOFF2均loaded、两个可见公式及两个MathML、一个SVG、任务列表与代码，脚本/链接/私有全局为零，额外网络请求与拦截错误为空。独立页面截图已核对。Windows构建成功，katex-vendor296.70 kB、字体异步包349.19 kB，原500000/700000字节门槛保持。此证据只说明首轮已通过的场景，不提前关闭10或整体A10。

以下归档已下载并复核SHA-256；前端commit.txt精确匹配40349cb，全仓suite-results显示仅tests目录失败，其余15目录成功。

| 归档 | ID | SHA-256 |
| --- | --- | --- |
| frontend | 11691128441 | 3397ceccb9fa0eb03201a3d1e33d72a19f0568425f001fd40085d4cc999cd5e0 |
| repository-tests | 11692025019 | 61ccd5e99df2a9902a989dee237fe748ce98558f628a3882cfcd82dd387b7bc3 |

只修改两份测试及必要交接/审计记录；产品、锁定依赖、工作流、531模块清单、59风险源指纹、原始夹具、此前验收与失败记录保持。36项HTML契约、51项实际页面及所有准入门禁保留，没有运行本地产品测试/浏览器/构建/Rust。GitHub用于核查七组/步骤/日志与两份归档；这次小范围契约修正不涉及新的第三方API或架构，不重复调用Context7或Mermaid Chart。修复静态复核：四项门禁、两份脚本语法、29个嵌入表达式、5段CSS与6个本地令牌通过；JSON/YAML与141个相对链接、59风险源指纹通过，1265个其他Git跟踪文件字节保持，R12根历史、阶段验收/实施历史及09首轮失败/修复保持。差异复核通过；10待新精确head Windows重验，11未开始。

## 正式验收（2026-10-11）

`00930e00114a921f89a7d37ac3b3fb159ed20778` / [CI38135455053](https://github.com/uniquenesssta/mdr/actions/runs/38135455053)，attempt1，七组和所有执行步骤成功。全仓1914/1914（336文件16目录）、前端909/909、HTML36/36、原文30/30、原格式43/请求31/任务16/取消22/进度20、Builder21/增强27/Styles21/安全6/Settings5、浏览器11/11＋51/51、Rust281、真实Windows导入8/8通过；最终精确提交准入accepted=true。

四份归档已下载并复核SHA-256；frontend/WebView的commit.txt和final JSON均为00930e0，递归16目录全部退出0。

| 归档 | ID | SHA-256 |
| --- | --- | --- |
| frontend | 11700468724 | 32dee77d85817abe471d0813371e4a713de9a5499ebb50086966e9be453bec6d |
| repository-tests | 11700174188 | 34d6d1393f6a7d10ef934c7b3ad00fb252cb898394946a6f32e3b141e6bc2788 |
| exact-commit closeout | 11700938065 | e9e7c3f24653cb7c0b7b58f4395d8b873e002d6dfa6aaa53f6d7d19ffa82692b |
| actual Windows WebView | 11700843105 | 5efa9bd4d7128aafa9d65f8539124252440f225624d92b5b06e4051dea8c2e3e |

独立HTML原文件与截图已核对：20字体全部loaded，两个可见公式/两个MathML、一个SVG、任务/代码完整，HTTP失败正控成功且没有额外资源请求。空、中文/emoji与450024字符正文均完整，MIME正确，URL撤销、Preview原节点身份、任务释放、端口作用域全部true。过时原文首次零输出、下一次只生成新正文且清理成功。F02旧HTML运行时与本格式离线字体/完整正文要求通过此提交；用户自带图片URL策略、Word/打印/图片后续职责、整体A10及独立Editor问题保持。

首轮40349cb / CI38110755648失败及其修复原样保留为历史。14.10正式收尾，用户要求开始14.11，仍使用唯一分支agent/r14-stage。
