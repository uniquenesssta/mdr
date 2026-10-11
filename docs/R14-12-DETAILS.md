# R14-12 PDF Exporter

状态：**首轮 Windows 未通过，两处清单/探针错误已修复，待修复提交累计重验**；14.12不勾选，14.13未开始。唯一分支`agent/r14-stage`，基线为11正式验收提交`6d0f822973f8452c7b84e11916b7c59e30979e3d` / [CI38146793150](https://github.com/uniquenesssta/mdr/actions/runs/38146793150)。

## 11收尾

七组Windows及全部步骤通过，全仓1943/1943（337文件16目录）、前端938/938、Word29/29、HTML36/36、Markdown30/30、浏览器11/11＋54/54、Rust281、真实Windows导入8/8和最终同提交accepted=true。四归档SHA-256一致；原始Word .doc按HTML容器在网络拦截期间加载，20字体逐项loaded、完整0/21/450024字符正文、数学/MathML/SVG/任务/代码、过时首次0/下一次1输出与原Preview/任务/URL释放均通过。没有真实Microsoft Word/Office COM版式证据，原有边界保持。[11正式验收](R14-11-DETAILS.md#正式验收2026-10-12)。

## 职责与完整链

`formats/pdf-exporter.js`是唯一PDF准备与任务所有者；`document/pdf-print-surface.js`独立负责临时打印文档、资源等待、打印完成事件/回退和节点/定时器/监听释放；`compatibility/classic-pdf-export-port.js`提供只读作用域命令，不拥有或销毁共享资源。main创建/注入并在文档功能重建和pagehide先销毁PDF所有者/端口/打印面，再释放共享依赖。

旧经典PDF的任务编排、wasSource状态、deactivateVirtual、替换preview、reset恢复、afterprint监听和两段定时器全部迁出并删除。经典命令仅标准化请求、调用公共端口、处理busy和非取消错误。原Menu调用与公共`exportPDF`名称保持。原浏览器打印适配器代码不修改；组合根向打印面注入`createBrowserPrint({windowObject: frameWindow}).print()`，feature不直接实现平台打印。

PDF请求在task前再次标准化并固定pdf能力，校验文档存在及当前身份，捕获Documents generation/activeId、模型version。Builder生成完整安全正文并验证原始WeakMap来源，公共Enhancer完成任务/代码/数学/Mermaid，共享字体缓存加载20项锁定WOFF2。每次异步返回及92%序列化进度同步重入后校验来源；不重新读取经典预览私有变量，也不获取旧编辑器快照代替完整模型。

打印面创建无src、无srcdoc、无网络导航的同源初始空白iframe，克隆Builder正文，不移动原节点；通过DOM API设置语言/UTF-8/标题、公共PDF CSS和内嵌字体CSS，正文根标记pdf。打印文档没有应用脚本或应用样式；原应用`@media print`规则继续服务浏览器直接打印页面，不参与PDF命令隔离链。原图片/链接引用保留，不扩展抓取/缓存政策；现有图片decode失败不阻断全部正文，资源最长等待10秒后错误退出。

逐项加载打印文档的全部FontFace并等待字体与图片准备。80ms打印延迟仍可取消/被新任务替代；紧邻实际平台调用前复核来源、锁定printing、更新进度并再次复核同步重入。真正发起打印后保留唯一任务锁，其他格式得到busy；完成仅清理自己的打印文档，不按过时来源重置当前文档。打印状态表示已调用打印并完成清理，不声明用户选择了PDF或保存成功。

afterprint在对应iframe Window监听；同步事件仅记录完成信号，直到阻塞打印调用返回再移除frame。无事件时1200ms回退从打印返回后开始，避免在原生打印窗口仍打开时删除内容。资源/打印错误、取消、身份/版本变化、替代任务、独立destroy及pagehide都幂等清理，观察晚到Promise拒绝；移除监听并清除准备/打印/回退定时器。初始化失败和清理失败同样释放任务，原错误身份优先；旧事件/旧回退不能结束新任务。

## 旧断言目的与当前契约

| 旧验证目的 | 当前验证 | 保留场景 |
|---|---|---|
| 原PDF afterprint/1200ms回退重建Preview恢复source | 打印面移除且原Preview节点/视图保持，任务至完成才释放 | 正常结束、缺少afterprint、重复/晚到事件 |
| PDF准备取消先恢复临时视图 | 无视图切换/替换，取消零打印、零残留帧 | 准备取消、任务释放 |
| 视图初始化/恢复失败仍释放任务 | 隔离文档初始化/平台打印失败释放，Preview调用故障不得被触发 | 初始化异常、打印异常、任务清理 |
| 公共PDF样式租约在原Preview根释放 | 同一公共PDF CSS在隔离文档内使用，移除frame即释放文档资源 | afterprint、回退、父文档无样式污染 |
| 平台适配器不负责afterprint/restorePreview | 适配器保持纯委托，准备/释放在公共PDF所有者和打印面 | 委托/返回值/原错误身份/不可用面 |
| 实际PDF/Image查看临时Preview里的增强结果 | 实际打印面查看增强结果，Image链与PNG断言保留 | 数学、SVG、任务、代码、格式、Image释放 |

原14.1夹具不改写，HTML36/Word29/Markdown30及其他已验收专项场景保留。旧四项PDF契约、平台职责静态断言和实际PDF/Image探针只调整已过时的路径/视图恢复要求，原目的没有删除。全仓与前端递归Windows收集/失败退出、七组准入、依赖锁及原体积门槛不放宽。

## 新验证与证据边界

新增`tests/stage-14-pdf-exporter.test.mjs`定义33项契约：空/Unicode/大正文×afterprint/回退，格式和文档身份，五个等待阶段×取消/替代/销毁，来源/generation/activeId/version/移除，序列化/printing同步重入，依赖/平台原错误，阻塞返回前不删除帧，异步打印晚到失败，旧事件/回退隔离，字体准备/超时/失败，初始化/调度/清理失败，独立销毁、只读端口和实际经典命令的source/preview/hybrid状态保持。确定性DOM/定时器适配器只用于调度观察，公共产品所有者/打印面/平台适配器均真实执行于Windows。

新增3项实际built-app页面回归，累计57：四种edit/preview/hybrid/both布局下完整打印资源及Preview/Hybrid节点、视图、布局、选择、滚动、焦点保持；真实打印API边界异常/缺少事件回退后下一次成功；80ms实际延迟内取消/正文变化零打印、下一次当前正文打印成功。原最终pagehide额外准备真实PDF面后以原locked任务替代，卸载清理帧并确认旧延迟零调用与PDF端口移除，原任务/Builder/Enhancer销毁目的保留。

上述浏览器探针控制打印调用完成/失败事件，验证真实生产DOM/资源/锁/清理链。没有自动操作系统打印窗口，没有操作用户另存对话框，也没有生成文件后的PDF字节或实际打印机证明；这些不能从接口边界和DOM证据推断。整体A10仍等待本提交打印完整链及14.16图片链验收，未标R14收官。14.13～14.17职责不提前扩展。

Context7查询MDN print阻塞、afterprint和iframe生命周期，与项目既有平台适配器核对，无新增/升级依赖。Mermaid Chart展示真实中文独立打印/共享资源/唯一任务/平台/清理链。GitHub核对11七组、同提交最终准入及四归档。新产品Node、浏览器、构建与Rust仅交Windows执行；Actions启动后结束，不轮询，约15～20分钟后查询。

静态四项门禁全部通过；14份脚本语法、33段浏览器内嵌表达式、5份CSS/6个本地令牌、JSON/YAML、150个相对文档链接、67项风险指纹和diff空白检查通过。539行生产模块登记保留原536行，1263个受保护跟踪文件原样保留；R12历史根数据、阶段历史前缀及11实施内容保留，旧54项实际页面目的和旧PDF场景经映射保留、新增3项。七组Windows定义仅追加PDF专项步骤；没有在本地执行产品Node/浏览器/构建/Rust。这是初次实施的静态记录；首轮Windows PDF33/33、实际页面56/57结果与失败原因见下方，修复后的完整33/57及七组准入仍待新精确head验证。12保持未验收，13未开始。


## 首轮失败与修复（2026-10-12）

`da4c3092a09fa02a0423c08b22367d322c372df5` / [CI38155745041](https://github.com/uniquenesssta/mdr/actions/runs/38155745041) attempt1 未通过，最终同提交汇总准确记录accepted=false和`Browser evidence failed: browser-app.log`。实际WebView、原生链接、依赖三组通过；全仓、前端、Rust守卫及最终汇总四组失败，直接原因只有以下两处。

| 失败位置 | 证据与修复 | 保留要求 |
|---|---|---|
| 模块清单校验 | PDF exporter和print surface的migration误填`public-feature-owner`，不属于既有合法值；module-inventory同一断言在递归Node、前端兼容、Rust接口守卫三处失败。两行改为既有`retain`，与HTML/Word所有者及共享文档模块一致 | 不添加迁移豁免，不修改测试合法词表/精确生产路径/缺失重复幽灵文件校验；539行及其余537行原样保留 |
| 实际四布局探针 | `editor.virtualEditor.root`从未属于当前适配器接口，读取childNodes时抛TypeError，发生在exportPDF调用之前；改查editor内真实`.cm-content`，要求连接且非空，文件名焦点切换后等现有idle屏障，再采样原节点 | 四个edit/preview/hybrid/both布局全部保留，补实际根仍相同的检查；原子节点身份、视图/布局/选择/滚动/焦点、完整数学/MathML/SVG/代码/任务/字体及清理断言保持 |

递归Node1975/1976（338文件16目录）唯一失败是清单；前端971/971、PDF33/33、其余已验收专项通过，浏览器契约11/11、实际built-app56/57。Rust269＋5＋1＋6、Clippy/check、安全写入等执行步骤通过，但Rust formatting因前序接口守卫失败跳过，不能声称Rust七组全部通过。真实Windows导入/安全组、原生组及依赖组全部步骤成功。

已核对实际JSON：打印timeout/failure/recovery均一次平台调用并移除frame、释放task、关闭进度，只有注入错误一次报告；取消/正文变化/恢复打印次数0/0/1，恢复内容为当前原文，每次均释放；pagehide准备的真实PDF frame移除，旧延迟零打印、晚到PDF拒绝及原任务/Builder/Enhancer释放通过。四布局失败截图已查看，但它只证明失败现场；该用例在打印前中止、没有生成`r14-12-isolated-print.json`，完整四布局资源与节点证据仍须新Windows提交验证。

下载ZIP计算SHA-256与GitHub摘要一致，并核对日志/commit及run metadata的精确提交：

| 归档 | artifact ID | SHA-256 |
|---|---|---|
| 前端 | 11708063672 | d3f2e28c0473d58edf46585708c497a16bf16a87d4fedce4ba614f0c5af1912e |
| 递归Node | 11708253436 | 3c11e5cf5060e84acb1abb33d3564881e83d9612e96d336297ea9e3fb1f611a1 |
| Rust | 11708019613 | 6d7d67416b741da5ccb5562771ff759f85b841425614a3c994abf8b730e09891 |
| 最终汇总 | 11708169126 | 9d49eaebd899f9efafa54350d455ea10a5c7369ee31d33ad303cde25faf07637 |

本次修复只改两份清单/浏览器测试文件及必要状态/审计文档；产品源和67项风险指纹、依赖锁、workflow、原始夹具、已验收历史、全部33/57场景保持。初次语法/架构静态检查不能证明清单合法值或真实DOM接口；本次静态额外逐行核对既有清单合法迁移词表与真实CodeMirror挂载路径。新精确head完整Windows证据到达前，14.12保持未通过，14.13未开始，整体A10未收官。Actions启动后结束，不轮询。

修复后静态四门禁全部通过；脚本语法、33段内嵌浏览器表达式、5份CSS/6个令牌、JSON/YAML、151个相对链接及67项风险指纹通过。539行清单按既有surface/migration词表逐条核对，仅两行迁移值更正、其余537行完整保留；原浏览器用例名称顺序及33/57场景不变，另1278个跟踪文件、历史审计根与正式验收内容保持。本地未执行产品测试、浏览器、构建或Rust；完整通过状态须新提交Windows七组结果决定。
