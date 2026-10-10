# R14-08 Export Styles

状态：**正式验收通过**。精确提交 `22cbd6820ef2703ff1252110f70c71bb6a201114` / [Windows CI38072508148](https://github.com/uniquenesssta/mdr/actions/runs/38072508148)，attempt1，七组及全部执行步骤成功；14.8勾选。用户要求“收尾08开始09”，同分支 `agent/r14-stage` 推进 [09](R14-09-DETAILS.md)，09待本提交Windows验收。下方首轮失败与修复段保留对应历史状态。

## 07收尾与本项范围

07精确head、七个job及全部执行步骤通过：全仓1815/1815（332文件16目录）、前端810/810、安全6/6、增强27/27、Builder21/21、导出/请求/任务/取消/进度43/31/16/22/20、Settings5/5、浏览器11/11＋42/42、Rust281项与真实Windows导入链8/8。前端、全仓和最终汇总三个归档摘要一致，正式证据、首轮失败及测试修复均见 [07详情](R14-07-DETAILS.md)。KaTeX兼容补丁通过，A10最终完整离线格式门槛保持。

此前已接收的PNG公式额外x2/21在成功CI产物中仍存在。源码没有显式加载完整KaTeX CSS，只有自有display间距/font-size规则；锁定0.18.2的[官方样式源码](https://github.com/KaTeX/KaTeX/blob/v0.18.2/src/styles/katex.scss)规定辅助MathML为absolute、1px、clip-path inset(50%)、overflow hidden。[官方问题说明](https://katex.org/docs/issues)把辅助内容可见作为缺失CSS的诊断。完整锁定样式缺失已在静态链路确认；原PNG不能仅凭解码/节点数量宣称视觉正确，修复效果仍须本提交Windows像素与图片证据。

本项完整迁移文档内容样式：HTML/Word重复模板、打印内容规则及Image稳定颜色/排版。图片比例/高度、资产预载、离线字体封装、格式文件写入、打印隔离计时器和全部暂存节点释放仍按后续任务职责实施。

## 唯一样式所有者与所有调用者

新增 `src/features/export/document/export-style-sheet.js`，由公共Export入口导出 `createExportStyleSheet`；经典调用者只消费作用域 `classic-export-style-port.js` 的冻结 `getCss(format)` 和 `apply(root, format)`。main创建唯一owner并注入可信锁定CSS资产，不读取用户文档或动态拼接用户CSS。

文档正文、标题/段落、代码与行号/token、任务列表、表格、引用、图片、标准SVG及数学规则集中维护；格式profile仅保留真实差异：HTML宽度/边距、Word12pt与标题点单位、打印纸面/分页、Image主题。Word文本CSS将本地颜色变量解析为字面值，并使用普通行布局，不要求Office支持CSS变量或Grid。

| 原职责 | 新公共调用 | 生命周期与边界 |
| --- | --- | --- |
| HTML内嵌CSS | `getCss('html')`，body绑定公共类/profile | 纯文本，无活DOM副作用；旧CDN与独立脚本由14.10接收 |
| Word内嵌CSS | `getCss('word')`，body绑定公共类/profile | 与HTML共用内容规则；本项不宣称真实Office完整格式通过 |
| PDF内容打印样式 | 增强正文挂载前`apply(body,'pdf')` | afterprint/原fallback及异常释放；壳几何继续由export.css负责 |
| Image稳定排版/颜色 | `apply(clone,'image')`贯穿增强、准备与编码 | success/error/cancel finally释放；高度/裁切清理保留原场景 |
| Preview/Hybrid数学 | main显式导入锁定`katex/dist/katex.css`，在应用样式之前 | Vite打包字体路径；既有应用间距/字体覆盖保持，无导出类污染 |

main另以Vite `?raw`取得同一上游CSS文本供文档序列化，保留原始数学布局规则，仅去除相对字体URL的`@font-face`，避免导出文件产生错误的fonts相对路径；字体可携带封装仍由14.10/14.11负责。未复制或人工翻译整个KaTeX布局，也未更新任何依赖/锁包。

## 作用域与释放

只在`.export-document`及经过校验的format下生效，Preview/Hybrid根不添加导出类。HTML/Word/PDF保留官方可访问MathML裁剪；PNG没有可访问树，仅在Image作用域设置辅助MathML display:none，不删除源DOM或换用另一套数学渲染器。Image颜色与代码token消费既有主题令牌。

owner惰性挂载一个活style节点并管理每个根的lease。release恢复原类/format；同根替换先释放旧lease，迟到旧release不能清掉新profile；不同根独立释放。destroy幂等恢复所有活根并移除自身节点，拒绝迟到get/apply。输入format/根/所属文档检查在挂载前执行；样式节点挂载失败保持根原状并允许重试。桥接卸载只撤销端口，不销毁owner或替代宿主属性。

pagehide逐项释放任务、增强器/Builder、进度与样式owner/端口，一项既有清理异常不阻止其他释放。原PDF80ms交接与1200ms恢复计时器仍由14.12接收，原Image暂存正文仍保留至下次替换/14.16完整释放；本项只解除样式作用域，没有把后续资源职责标为完成。

## 契约映射与 Windows 证据门槛

新增21项公共样式及真实经典调用链契约：四profile内容/数学规则、锁定布局完整性、可访问裁剪与Raster-only隐藏、非法/外国根、注入失败重试、单节点/多根/同根替换、恢复/幂等销毁、冻结端口/替代宿主保护、两格式实际CSS序列化、PDF afterprint/fallback、Image成功/失败/取消释放。

原43/31/16/22/20、Builder21、增强27、安全6及Settings5场景保留。VM新增接入真实Style owner；DOM/vendor替身只证明编排，不用它们证明字体、SVG、PNG或系统打印。原格式夹具、名称夹具与冻结模型/存储保持。

原42个built-app场景保留，新增三项为45：

1. 捕获实际HTML/Word文件，在去除script/link后的独立iframe验证其自身CSS：两个公式与MathML裁剪、图表、代码行、任务列表、表格、字号。iframe无应用CSS和脚本，不表示离线字体/原独立脚本已完成。
2. 浅/深色均走实际Image出口和锁定dom-to-image-more3.10.0；解码实际PNG，与同一正文移除全部MathML后的参考PNG逐像素比较，必须零差异；可见x2/21文本正对照必须改变像素。归档实际/参考PNG与差异JSON，不用“有两个KaTeX节点”代替视觉验收。
3. Preview/Hybrid真实数学节点在导出作用域挂载与释放前/中/后保持连接、相同计算样式和可访问裁剪，视觉HTML不能被隐藏。最终pagehide场景追加活lease、style节点和端口释放断言。

原18个实际文本产物、完整长文/Worker资源、取消/失效/销毁、真实打印交接/PNG及文件边界均保留。CSS测试原“index.css必须位于main第一行”映射为唯一应用入口、唯一锁定vendor CSS及vendor先于应用覆盖的顺序断言；原全局语义token检查追加仅限本owner且实际声明的`--export-*`局部令牌，其他文件未知令牌仍失败。

## 静态复核与待验限制

本地仅执行架构/退休运行时/生成文件/README四项静态门禁，以及脚本/嵌入表达式语法、JSON/YAML、链接、源指纹、冻结/夹具/历史保持与diff检查；四项门禁通过；9个脚本、19个实际页面嵌入表达式与5段样式语法通过；JSON/YAML、118个相对链接、52项风险源指纹、9个冻结文件及24个保留文件字节与旧验收/失败历史保持核对通过。未运行本地产品Node测试、浏览器、构建或Rust。产品测试与真实图片结果只由本提交Windows CI决定，14.8尚未验收。

Context7已核对KaTeX双输出/样式职责与Vite7导入文本/字体重定位，并结合锁定KaTeX0.18.2源码与Vite7.3.6本地解析实现核对；Mermaid Chart已显示实际中文共享样式、四格式、Preview/Hybrid及释放链。CI新增export-styles.log，保留原七组与全部累计门禁。启动后结束会话，不轮询，约15～20分钟后查询。

F02旧HTML CDN/应用内变量引用、离线字体、14.12打印隔离和14.16图片完整资源释放保持接收；独立Editor指标错误继续开放。07验收、R12历史公告/交接以及所有失败/修复事实均不重写。


## 首轮失败与修复（2026-10-11）

精确提交 `b9a565d1d7b86fb25bc9816710d6de92e6ff0f19` / [CI38057924490](https://github.com/uniquenesssta/mdr/actions/runs/38057924490)，attempt1，未验收。依赖、全仓Node、Rust和原生四组成功；前端与真实WebView两个直接失败，最终汇总正确阻断。前端831/831、样式21/21、浏览器契约11/11、built-app44/45；原42个built-app场景和新增独立HTML/Word、PNG场景均通过。

| 失败 | 实际证据与原因 | 本次修复与保持的门槛 |
| --- | --- | --- |
| Preview/Hybrid数学隔离 | JSON为preview4/hybrid0。`.preview-content`还包含隐藏图片正文；`.virtual-editor-host`无真实根，而且测试始终双栏模式 | 分别切换实际both/hybrid布局，读取真实#preview/#editor。标准多行块公式夹具，每个可见界面必须恰好两公式，挂载/释放前中后比较实际节点引用、连接及裁剪；原45项保留，无放宽计数 |
| 实际Windows WebView无窗口 | job114230087956，Builder会话前报No window could be found；没有产品断言执行。应用日志空，性能日志只有PID9212的app.start；不能据此推定产品初始化/CSS/驱动版本是原因 | WebDriver HTTP就绪后先确认本次PID非零原生窗口，保存快照。仅窗口启动超时且进程存活允许一次新进程恢复，原进程必须确认退出，首轮日志/诊断不能覆盖。准备/产品断言、退出进程、协议错误、缺失诊断或清理失败均不重试；连续失败仍阻断 |
| 最终汇总 | job114231428329，Browser evidence failed: browser-app.log | 保留七组及同提交全部成功要求，无更改汇总规则 |

两个归档已经下载并核对SHA256：frontend artifact11672059372为`acc0fb2b8e1f748a67e4cf026a72f3882148158fa0a18f32de70d3552140272b`；webview artifact11672305369为`51f04fb089bb58957d012ac9d0214019ea0d51b3fb0e512e501e1a626be62b92`。首轮Windows已证明实际HTML/Word只用自身CSS仍有两公式、MathML可访问裁剪、一SVG及代码/任务/表格样式。浅深色实际PNG均1080×2355，对移除MathML的同正文参考零像素差异；浅色可见额外文本正控改变525252像素。两张实际图片均已视觉核对，无原额外x2/21。该部分证据不替代失败的Preview/Hybrid及WebView，不宣称14.8整体验收。

修复只修改测试编排与工作流接线，产品共享Styles、KaTeX0.18.2、其余锁包、冻结模型/存储、原始导出夹具及历史验收均保持。`embedded-session-lifecycle.mjs`独立拥有测试进程启动尝试与退出责任，Selenium/native细节仍由原session adapter负责；无生产插件或权限扩展。12项新回归验证正常顺序、先记录/停止再重启、两次失败保留、进程已退出/协议/界面准备/产品断言禁止恢复、清理失败/仍存活/诊断失败禁止恢复以及spawn失败；Windows目标运行前追加同文件，完整Node和前端仍执行它。

部分已创建WebDriver会话若attach或timeout初始化失败，会先quit；quit失败保留原错误且不允许恢复。停止host注册退出监听后kill，确认exitCode/signalCode并刷出日志。正常native关闭使会话失效时，仅在host已经退出才接受quit错误。新归档含`*-application.log.native-window.json`和`*-startup-1/2.json`及原应用日志，恢复日志使用独立recovery标签。底层首次无窗口原因仍未确定，恢复与所有新验证必须通过Windows实跑后才能确认。

本地只执行静态门禁及语法/嵌入表达式、文档、差异与保持检查；没有运行本地产品Node/浏览器/构建/Rust。Context7核对Selenium会话创建和finally quit语义，结合实际测试client4.34.0及归档plugin1.5.0、同版本官方源码核对：HTTP服务器启动不表示Tauri webview窗口已登记。Mermaid Chart显示真实两界面核对与一次启动恢复/释放链。14.8待新CI、14.9未开始；此前Editor指标错误和14.10/11/12/16完整格式门槛保持。

本轮最终静态复核：四项门禁通过；4个修改/新增脚本及20个嵌入页面表达式语法通过，5段共享CSS与6个本地令牌声明保持；JSON/YAML、130个相对链接、52项风险源指纹、9个冻结文件及11个额外受保护文件字节保持、R12根历史与各阶段验收/失败历史保持、diff复核通过。12项新生命周期测试尚未在本地执行，其通过状态只由新Windows CI决定。


## 正式验收（2026-10-11）

远端branch head、run.head_sha、四个归档commit.txt及最终同提交准入一致：`22cbd6820ef2703ff1252110f70c71bb6a201114` / CI38072508148 / attempt1。七个job及所有执行步骤均success，无跳过或取消的验收步骤。

| Windows证据 | 结果 |
| --- | --- |
| 全仓递归Node | 1848/1848，334文件、16目录；16个目录结果全部0 |
| 前端全量 | 843/843 |
| Styles / 启动生命周期 | 21/21、12/12（WebView合并契约24/24） |
| 导出 / 请求 / 任务 / 取消 / 进度 | 43/31/16/22/20，全部通过 |
| Builder / 增强 / 安全 / Settings | 21/27/6/5，全部通过 |
| 浏览器契约 / 实际页面 | 11/11、45/45；首轮失败的真实Preview/Hybrid场景通过 |
| Rust / 原生 / 依赖 | Rust281、Clippy/check/format、Windows链接及依赖门禁通过 |
| 真实Windows导入与安全 | 8/8，acceptedSecurityBoundary=true；原生PID5240窗口快照393338、1044×788；本次无需启动恢复 |
| 最终汇总 | accepted=true，commit与run精确匹配；历史R12的eligibleForR13字段不表示R14整体收官 |

| 归档 | ID | 校验的SHA256 |
| --- | --- | --- |
| frontend | 11677376333 | d442f399c731c2b036cfcd5ef6f1d4a2558995a7dc0eb05fc7362f203551b4f1 |
| repository | 11677670803 | ff5e238a8b3f2d48aa921c46182034e88c98b4c2f693d28abfd729545c702ae4 |
| WebView | 11677571157 | 71d18d18d1482b18fcb76f0c00b89410831fd99f3022ecaba5f145fa9c3004e9 |
| closeout | 11677511548 | 9e9334bd7ac733949d90282ff09c4e41dc4cac921b95a99c8ed537b3e8899d05 |

实际HTML/Word隔离文档仅依赖自身样式，两个可访问MathML、一个SVG及代码/任务/表格profile通过。浅深色实际PNG均1080×2355，对同正文移除MathML参考的差异为0；浅色可见额外文本正控改变525252像素。两张本次成功提交的实际PNG已视觉核对，公式为x²与1/2，无此前额外x2/21。Preview与Hybrid各恰好两个公式，真实可见#preview/#editor在作用域前/中/后保持同一节点、连接与官方MathML裁剪，HTML可见层未隐藏。

本验收关闭08共享样式及PNG辅助内容缺陷，不替代14.10/11离线字体与完整文档、14.12真实打印隔离、14.16全部图片节点/资源释放或A10最终完整格式门槛。首次无窗口的底层原因仍未确定；本次正常启动与12项严格恢复边界契约通过不证明旧失败的唯一原因。独立Editor指标错误保留开放。07/R12旧验收与所有失败归档不重写。
