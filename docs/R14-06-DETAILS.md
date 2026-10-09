# R14-06 Document Builder

状态：**首轮Windows未通过；本轮修复已实施，待新精确提交累计重验**。继续 `agent/r14-stage`，基线 `45bcdd14debf2ab030df66f44e6588d29915a440`；14.6保持未勾选，14.7未开始。

R14-05正式实现验收仍为 `11d2eb4` / CI37929409192，历史两次失败与对应修复不变。文档收尾 `45bcdd1` / [CI37931528219](https://github.com/uniquenesssta/mdr/actions/runs/37931528219) 七组及全部执行步骤成功，已核对精确head、job和step；审计记录追加该收尾重验，不覆盖正式实现证据。新一轮不能继承05的成功作为06验收。

## 首轮失败与本轮修复

`ccef6988c079968407c61e949d024d93f31cb0f9` / [Windows CI37935424278](https://github.com/uniquenesssta/mdr/actions/runs/37935424278)，attempt1：七组中五组成功，frontend与最终收尾失败。全仓递归Node1771/1771、前端Node766/766、Builder20/20、原导出41/41、请求31/31、任务16/16、取消22/22、进度20/20、浏览器契约11/11和生产构建通过。直接失败只在built-app的三个场景（36/39）；收尾正确拒绝失败的browser-app.log。其余WebView、依赖、Rust、全仓Node和原生组均成功，不能因此接受本项。

前端artifact11618016915的SHA-256 `f9eb33fbdf8f4c2f45f6144e19dd832836a924bb7a5be7378e70d4e5dfa37108` 已校验。旧归档只有日志，没有实际探针JSON或失败截图；首次HTML下载探针也没有返回已捕获的底层console错误。下面区分已观察失败与源码确证的缺口，不把缺失的原始错误补写成日志证据。

| 实际失败 | 源码复核与修复 | 保留门槛 |
| --- | --- | --- |
| 首个空名称HTML没有下载，Word尚未执行 | HTML/Word标题调用的escapeHtml已无生产定义，而VM上下文偷偷注入它。增加Export自有escapeExportTitle，两个调用者切换；移除VM注入 | 每个名称三种格式真实Blob、MIME、正文、转义标题、URL回收与任务结束全部保持；缺少退休全局也必须成功 |
| 长文137段完整但发生full-preview-export | built-app原来把HTML注入不透明about:blank页面，再从假HTTPS来源导入模块；仅页面CDP Fetch无法承载独立Worker目标，同来源Worker条件也不成立。新增回环HTTP服务，原始dist页面、模块、CSS、字体与Worker统一从真实来源加载，使用浏览器原生存储 | 实际Worker资源请求须200；仍要求全部137段、标题、有序、离屏、无全文快照，首两批48/96 |
| 取消探针没有块批次，返回未取消正文 | 保留原取消监听与完整正文要求，在真实Worker链路重验；不强制返回快照或绕过公共Builder | 第一批取消必须拒绝正文，释放任务后下一次build仍包含全部段落 |

仅生产变更为经典Export调用者的标题转义；Builder、Preview捕获、Worker算法、冻结模型、进度/取消实现不改。这里的源码缺口已确认，但修复是否消除三个观察失败仍必须由新Windows实际运行确认。F01增强、F02独立HTML旧脚本/CDN、剩余F04增强/打印与A10仍按原接收项处理。

原41/31/16/22/20专项及39个built-app场景保留。导出基线追加HTML与Word两项无退休escapeHtml的转义标题回归（41→43），新增HTTP测试服务三项（页面/模块/Worker字节及MIME、越界/坏路径/缺失/方法拒绝、HEAD与端口幂等释放）。旧构建产物解析工具及其历史三项测试保留；本轮actual built-app直接加载原dist页面。服务仅绑定127.0.0.1随机端口，finally关闭浏览器再关闭服务器和全部连接。

浏览器三项探针JSON改为先写证据再断言；下载缺失错误附带已捕获错误与任务状态，最终保存实际页面console、exception与资源请求。工作流设置E2E_ARTIFACT_DIR到既有前端归档目录，失败截图和JSON不会再遗留在未上传的临时目录。全部七组、退出门槛、关闭风险判据和旧夹具字节保持。

Context7已查项目Windows Node22对应HTTP listen/address/close/closeAllConnections文档，关闭所有连接放在停止接收之后；Mermaid Chart已呈现真实中文HTTP页面、Worker、Builder、标题和文件边界链。本轮四项静态门禁、7个JavaScript脚本与11个嵌入表达式语法、JSON/YAML、110个相对链接、47个源指纹及历史/夹具字节复核通过。新测试/真实页面/构建仅在Windows运行，本环境不运行产品测试或构建。当前累计47个风险源路径全部保留，只有public/app/export.js本轮指纹更新并保留先前值；R12根验收、05验收和两次失败、06首轮失败均不覆盖。

## 公共构建职责

新增 `src/features/export/document/export-document-builder.js`，从Export公共入口导出 `createExportDocumentBuilder` 与 `ExportDocumentStaleError`。Builder只拥有活动构建及待执行帧；文档、Preview Worker、任务状态、增强和挂载界面仍由各自原所有者管理。新增 `classic-export-document-port.js` 仅将冻结的build能力挂到既有兼容host，没有新业务window属性或第二份构建逻辑。

组合根注入公共模型、活动文档身份、Preview捕获、共享Presentation、既有安全节点物化以及frame/cancelFrame能力。所有HTML/Word/PDF/Image正文调用直接进入该端口，经典 `createFullPreviewBodyForExport` 整段删除。Markdown原导出尚归14.9，不在本项重写。

Preview Render Engine增加只读 `captureExportSource()`：不创建新Worker，只读取现有同步会话；必须同时匹配模型对象、同步版本和本次Worker结果所属活动文档。公开值仅含blockCount、isCurrent与按索引创建离屏节点的能力，没有Worker实例、blocks可变对象或全文源码。块缺少预渲染HTML时仍复用原Markdown片段/引用定义与安全Block View；不修改冻结模型或Worker算法。reset/destroy使旧捕获立即失效。

| 路径 | 构建行为 | 全文读取与失效处理 |
| --- | --- | --- |
| 已同步且非空Worker块 | 按原顺序复用全部块；400000字符以下96块，达到阈值48块；批间让出帧并发布原building进度 | 不读取editor.value，不调用模型全文快照；每批及返回前检查身份、模型版本、任务和Preview捕获 |
| 无Worker、版本不匹配或空块 | 先等待可取消帧，再用 `createSnapshot('full-preview-export')`；保护数学、Markdown解析、恢复占位符并交安全节点物化 | 显式全文读取一次；快照之后、物化前后及返回前检查版本/身份 |
| 无解析器或解析异常 | 创建pre并以textContent保存原始文本；解析异常记录原错误 | 不把未转义HTML作为回退；DOM物化错误原样传播 |
| 取消、替换或任务销毁 | 使用既有只读token等待；不继续构建后续块或返回部分正文 | finally取消待执行帧；晚到帧不能发布结果 |
| 文档/版本/Preview改变 | 抛 `ExportDocumentStaleError`，继承现有取消错误，reason为document-changed | 丢弃未完成正文，不混用两个文档/版本；不额外快照重试 |
| Builder/pagehide销毁 | 独立拒绝有/无task的待执行构建，幂等卸载端口 | 全局Export逐项清理先中断Builder、卸载端口，再释放Preview和模型；保留前项任务/界面清理容错 |

Builder返回未挂载的完整markdown-body。它不提交文件、不修改预览、不运行数学/图表增强；后续格式所有者继续使用原取消/写入锁与finally。端口卸载不擅自销毁Builder，实例销毁由组合根负责。

## 原目的与新接口映射

R14-01 `contracts.json` 和14.2 `requests.json` 原始夹具完全保持。原41项导出、31项请求、16项任务、22项取消、20项进度场景名称与覆盖保留；切换的是本项已退役的构建接口和当前行为断言，没有跳过错误或降低Windows退出门槛。

| 旧断言目的 | 本项接收方式 | 保留及增加的覆盖 |
| --- | --- | --- |
| 如实记录退休Preview全局缺陷，替身成功不代表应用修复 | 原F04字符串/接收项保留；VM不再提供previewWorkerClient或createPreviewNodesForBlock，使用实际公共Builder | 正文和HTML/Word当前必须成功；PDF/Image仍检查后续旧增强/打印缺陷失败且不提交文件、结束任务 |
| 137块长文完整、有序并按96/48块让出帧，不读全文 | 原测试改调用h.build，实际公共Builder消费只读块能力 | 同一全部137块、HTML顺序、帧数及无snapshot/parse断言；actual built-app验证137段全部顺序、标题、分批进度和没有full-preview-export快照 |
| 过时Worker/空块显式快照；解析失败安全原文 | 实际Builder快照/保护/解析/物化链 | 原snapshot原因、每个原输入、源文本和raw fallback保留 |
| pending frame取消及时返回，不快照、不写入 | VM的frame适配动态调用原上下文，任务/进度仍为实际新模块 | 原取消/替换/晚到结果断言保持；新Builder专项检查实际帧句柄释放 |
| 实际HTML/Word缺陷与文件边界 | 当前捕获3种格式每个文件名的实际Blob、MIME、内容和URL清理 | 正文构建错误应消失；原始数学/图表未增强、旧CDN与应用私有独立脚本引用仍记录为未关闭缺陷 |
| 实际pagehide释放锁定任务与进度界面 | 原探针增加无task的pending build及构建端口卸载 | 原task/token/晚到错误/界面全部断言保持；Builder独立拒绝destroyed结果 |

VM仅测试DOM编排、Presentation和文件边界，不能代替安全DOM、真实库渲染、像素或原生I/O。仍需历史增强/打印场景的测试适配器只接后续接收职责，绝不注入退休Worker/块构建全局。真实built-app探针不补生产缺失绑定。

新增 `tests/stage-14-export-document.test.mjs` 20项构建专项：两个阈值批次、四种显式回退、三种任务失效、晚到帧/下一次构建、三种文档/Preview失效、错误请求身份、快照内变更、两种无task销毁、DOM错误、端口生命周期及缺少依赖。Preview Engine原专项新增3项：捕获不启动Worker，冻结有界能力/同版本文档切换/过时版本，以及reset/destroy使捕获失效。工作流追加独立export-document.log；原七组和全部硬门禁保持。

实际页面新增长文取消探针：第一批取消后拒绝返回正文、释放任务；下一次公共build仍返回全部段落。原长文探针改为成功映射；通过既有模型能力暂时观察createSnapshot并恢复原属性，不能在缺少观察器时空数组冒充“未快照”。页面销毁使用真实生产pagehide，实际安全渲染与导入链继续原Windows WebView门禁。

## 静态复核与待运行验证

更新生产模块职责清单，累计风险源覆盖45→47项；旧45个路径全部保留，4个变更源指纹记录旧值，增加Builder与其端口。R12根验收与历史R13/R14验收、05失败/修复历史保持。模型、依赖版本/锁文件、Rust、原生命令、数据/持久化格式及CSP不改。

本环境仅执行架构/文档/旧运行时/生成文件门禁、JavaScript与嵌入浏览器表达式语法、JSON/YAML、相对链接、源指纹、历史证据与diff静态复核。Node产品测试、浏览器、构建、Rust和实际WebView只在Windows执行；本地静态通过不代表20＋3项或累计产品测试通过。

首轮实施历史静态记录：四项静态门禁通过，11个变更JavaScript/测试脚本与11个嵌入浏览器表达式语法通过；JSON/YAML、110个相对链接、47个当前源指纹、原场景/夹具字节、历史验收及diff复核通过。原45个风险路径全部保留，41个指纹不变；R12根验收和05实施/失败历史原样保存。

完整Windows证据待推送后的同提交七组CI，14.6不能勾选。R14-F04本项构建部分已切换，但后续styleTaskLists/renderMermaidBlocks/observedPreviewBody由14.7/14.12/14.16接收；F01增强和F02独立HTML模板、F03完整格式产物仍待各接收项。A10新low风险不因本项测试通过而关闭，处置截止仍为14.7验收前，全部离线格式链截止R14收官。

回退只限本项Builder/端口、Preview捕获API与四个调用者切换，以及对应测试/清单/当前实施记录；不回退已验收的取消/进度能力，不恢复退休全局或保留旧Builder双实现。已用Mermaid Chart呈现实际中文构建/失效/销毁链。启动Actions后结束会话、不轮询，约15～20分钟后查询。
