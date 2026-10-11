# R14-11 Word Exporter

状态：**正式验收并收尾**（2026-10-12）；实施提交`6d0f822973f8452c7b84e11916b7c59e30979e3d` / [CI38146793150](https://github.com/uniquenesssta/mdr/actions/runs/38146793150) 七组与全部步骤成功，14.11勾选；按用户指令开始14.12。下方实施段落保留验收前的真实状态。唯一分支`agent/r14-stage`，基线为10正式验收提交`00930e00114a921f89a7d37ac3b3fb159ed20778` / [CI38135455053](https://github.com/uniquenesssta/mdr/actions/runs/38135455053)。

## 10收尾

七组与全部执行步骤通过，全仓1914/1914（336文件16目录）、前端909/909、HTML36/36、Markdown30/30、浏览器11/11＋51/51、Rust281、真实Windows导入8/8及最终同提交accepted=true。四份归档SHA-256一致，独立HTML的20字体、完整450024字符、过时首次0/下一次1输出与节点/任务/URL清理均通过；原文件及独立页面截图已核对。首轮失败及测试修复保持历史。[10正式验收](R14-10-DETAILS.md#正式验收2026-10-11)。

## 共享所有者与固定格式边界

本项明确要求“不复制HTML exporter”。原HTML已验收的任务、完整正文、增强、字体、原始来源屏障与平台输出算法提取到`formats/rendered-document-exporter.js`，原被动文件模板和完整标题转义提取到`document/export-document-serializer.js`。两处均只服务当前真实HTML/Word需求，不增加PDF/Image格式分发或插件注册。HTML公共工厂保留固定html配置；Word公共工厂固定word配置，调用方无法用format参数改变能力。

| 职责 | 唯一权威 |
| --- | --- |
| 不可变名称、目录、后缀和格式合法性 | 原公共Export Request；Word仍为.doc、extensions=['doc'] |
| 任务、进度、取消、写入锁 | 原唯一Task Controller，格式实例不创建另一套状态 |
| 完整正文及原始来源上下文 | 原已验收Builder；当前模型/同步Worker完整块，保留批次和快照策略 |
| 代码、任务、KaTeX与Mermaid | 原公共Enhancer；导出前生成完整DOM/SVG，不在文件内二次渲染 |
| 字体与版式 | 同一20项WOFF2惰性资产缓存及原Styles的word点单位配置；不复制CSS |
| 文件容器与转义 | 共享被动序列化器；Word仅固定CSS profile、doc标题后缀，HTML结果保持 |
| 格式工作流 | 共享渲染文档所有者；每个格式实例仅拥有自己的等待/销毁状态 |
| 保存与下载 | 原Platform saveFile/writeText与browser downloader；Word MIME application/msword;charset=utf-8 |
| 临时经典命令 | readonly scoped Word port；经典exportWord仅创建Request、委托和通知 |

旧Word模板、Builder/Enhancer调用、任务编排、原生保存及直接Blob/URL下载全部移除；随后无调用者的经典exportTextContent和escapeExportTitle删除。PDF/Image仍保留自身待迁移工作，getExportSaveOptions仍由Image调用。main创建公共Word owner/serializer/port，pagehide和两处Document feature清理先销毁格式实例及端口，再释放共同任务/正文能力。

共享所有者捕获Documents generation、活动身份及模型version，核对Builder来源，逐一保护构建/增强/字体/序列化/对话框与写前后。同步进度回调也重新核对；写前过时零输出，替代任务不被旧finally清掉。等待同时观察取消和格式owner销毁，迟到失败被消费；writing锁定后不能撤销已经提交的系统写入，销毁只抑制晚到结果，不重试或承诺回滚文件。

## 文件与离线承诺

保持项目原有HTML内容的.doc输出约定；本项不引入OOXML、Office COM或新文档转换库。完整UTF-8、zh-CN、viewport、正确转义title、word格式body、原权威Styles和内嵌字体形成无脚本、无CDN、无应用私有全局的文件。数学HTML与可访问MathML、代码/任务/表格、已增强SVG均保留。

Windows CI验证的是实际生成的.doc字节、保存/MIME/名称契约和其HTML容器的独立浏览器渲染。它没有启动真实Microsoft Word，不能据此宣称Office版本间的排版、SVG导入或嵌入字体支持已验证。原HTML .doc格式延续；如需真实Office版式，应另取对应应用证据，不用浏览器替代。

项目依赖仍锁定KaTeX0.18.2、Vite7.3.6、Mermaid11.16.1。Word复用10的同一惰性字体包，不再次声明glob或增加包；原500000/700000字节硬门槛保持。用户自带外链/本地图片与超链接保留原URL，不增加抓取、权限或自动离线缓存。此项不提前关闭整体A10、14.12打印隔离、14.16图片资源、14.17统一File Writer及独立Editor问题。

## 回归与接收

新增29个Word顶层契约，覆盖被动模板/全title转义、两平台空/Unicode/30000段正文、全部原名称/自定义目录、格式和文档身份任务前拒绝、四阶段×取消/替换/销毁、来源身份/版本与对话框变化、同步serializing/writing重入、六层异常原身份、picker取消/非法路径/不完整平台能力、已发写入锁定/销毁、HTML与Word共同任务及独立生命周期、冻结端口和实际经典调用链。取消严格确认原公共reason=cancelled，不复用首轮错误user预期。

原HTML36项及全部已验收场景保持。VM挂载真实公共Word/shared owner/serializer/Builder/Enhancer/Styles/字体资源，平台、DOM与vendor替身只证明编排；Windows built-app负责实际渲染。

原10的三项独立页面探针改为固定HTML/Word两格式表驱动，保留原HTML名称、内容/资源/状态断言及归档路径，新增3项Word，累计54：

1. 原始完整.doc内容在HTTP/HTTPS拦截期间按HTML容器加载，不改写文件；失败请求正控、20项字体逐个loaded、两公式及MathML、SVG/任务/代码、无脚本/私有全局/额外网络；核对word profile和12pt规则，归档原doc、独立截图和JSON，finally卸载拦截/移除frame/撤销URL。
2. 真实空、Unicode及450000+字符完整Word正文，严格检查doc.body的word标记，不查不存在的markdown-body；MIME、20字体、无脚本、Preview原节点身份、任务和URL清理与端口作用域均核对。
3. 实际serializing进度回调改变模型，第一次零文件，下一次仅当前新正文。最终pagehide同时确认Word晚到命令拒绝与端口卸载。

原格式43、请求31、任务16、取消22、进度20、Builder21、Enhancer27、Styles21、安全6、Settings5和HTML36测试文件不改写；14.1原始夹具及已验收包体积配置保持。工作流追加word-exporter.log，七组Windows和失败退出/准入规则完整保留。所有新产品测试、构建、浏览器、Rust交新精确head Windows验证，没有在本地执行。

Context7核对官方KaTeX静态htmlAndMathml输出仍需要CSS/字体但无需客户端脚本；文档未标明0.18.2专用快照，故结合已锁定源码与10实际字体证据，仅用于静态资源原则，不推断Office支持。Mermaid Chart展示真实中文两入口/共享所有者/Builder/Enhancer/字体/序列化/任务/平台/清理链。GitHub核对10七组和四归档精确提交。Actions启动后结束，不轮询，约15～20分钟后查询。

静态四项门禁（architecture、no-legacy-runtime、generated-files、readme-record）全部通过；13份脚本语法、29段浏览器内嵌表达式、5份CSS/6个本地令牌、JSON/YAML、149个文档链接、64项风险指纹及diff空白检查通过。536行生产模块登记含原531行原样保留；1258个受保护跟踪文件未改动，原HTML工作流与模板机械等价，原51项实际页面回归保留并新增3项Word。历史R12记录、阶段历史前缀、10首次失败和修复记录保留。以上是静态结果，29项新Word契约及新精确head的Windows产品验证尚未运行；11保持未验收，12未开始。

## 正式验收（2026-10-12）

精确提交`6d0f822973f8452c7b84e11916b7c59e30979e3d` / [Windows CI38146793150](https://github.com/uniquenesssta/mdr/actions/runs/38146793150)，attempt 1，七组Windows与全部执行步骤成功；最终同提交/同run `accepted=true`。全仓1943/1943（337文件16目录，全部16个目录退出0）、前端938/938、Word29/29、HTML36/36、Markdown30/30、原导出43/43、请求31/31、任务16/16、取消22/22、进度20/20、Builder21/21、增强27/27、Styles21/21、安全6/6、Settings5/5；浏览器11/11＋54/54、Rust281及真实Windows导入8/8通过。

四份归档已下载并核对SHA-256，前端/真实WebView的commit.txt以及最终准入commit/run与实施提交一致。

| 归档 | ID | SHA-256 |
|---|---:|---|
| repository-tests-windows | 11705292270 | `5199ea158b51db410ec34e32272e9e9fab562975db0967737f3ffb5bdd0d96a8` |
| r12-24-closeout | 11705263222 | `1dccd06c2b2acdbe65508dd31147bd6bcbfdb714deb6062c12b358c2df5d0bad` |
| r12-22-webview-verification | 11705127968 | `eb804e6bcc9e15aed1545bd311204bf26bf7dc2ef8ab8e536279ffd8ff3d6a9a` |
| r12-14-frontend | 11704653300 | `64d57ec452a1111969f3d44c9f25b7c7cbd63f187b9674785eee0c2ada120905` |

实际Word原始.doc内容按HTML容器在HTTP/HTTPS拦截下加载；请求正控被阻断且无额外请求，20项WOFF2字体逐项loaded，2个可见数学节点和2个MathML、1 SVG、任务项及4个代码token完整；无脚本/私有全局。独立截图可见标题、Unicode、表格、任务、公式、代码和图表起部，与JSON资源证据相互核对。真实0/21/450024字符正文均完整，Word MIME正确、20字体内嵌、URL撤销、原Preview节点与作用域保留且任务释放；serializing期间模型改变时首次零输出，下一次仅当前正文一份。

这些是既有HTML .doc容器与浏览器资源/正文证据，未启动Microsoft Word或Office COM，不推断具体Office版本的字体/SVG/版式支持。整体A10的打印/图片完整链仍接14.12/14.16，不将此验收写为R14收官。
