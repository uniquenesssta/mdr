# R16-03 全局 API 清除

用户授权“收尾02开始03”。R16-02已按0963dfe / CI39971556914精确Windows七组及全部步骤、验收汇总和WebView归档验收，收尾提交7c2c62e；继续唯一codex/r16-stage。范围仅16.3和受影响调用链，16.4未开始。

## 实现范围与边界

清除六个业务全局入口：DocumentModel、NativeDocumentStore留在组合根局部；Statistics及RuntimeContext改由已有所有者直接读取；LinkPreview通过显式构造接口，Hybrid仅接收导航能力；Performance通过公共Telemetry记录边界，Runtime负责连接/断开唯一Recorder。删除window[name]函数包装及其31个旧函数名目录，生产环境仍不自动创建遥测计时器/观察器。E2E仍只能显式opt-in安装既有查询入口，生产默认不开启。

控件提交、销毁、单元格导航和双击激活清理从DOM私有函数属性迁到既有Widget Lifecycle的私有WeakMap，所有调用者使用公共接口；终止时先撤销能力，再释放资源，过时注销不影响新所有者。保留代码、表格、数学、图片、HTML和Mermaid原有交互及写回。Geometry使用CodeMirror的requestMeasure和已注入的Scroll/Selection通知，删除指向已不存在的scheduleEditorMetricsRebuild全局函数的调用。

LinkPreview保留原界面，拥有document监听、overlay监听、动画帧及全部焦点Scope，部分安装失败回滚；销毁后拒绝新打开，晚到外链失败不再通知。销毁继续尝试全部释放并报告错误。通知显式接入既有Toast，不再读取window.showToast。

## 冻结与后续任务边界

八个JS冻结模型源码及全部10项保护指纹不变。DocumentModel内部有一处Stage0冻结的可选markdownEditorPerf读取：本任务删除了该全局的发布，因此读取不可达；没有为它恢复任何兼容全局。外部Document Snapshot Telemetry按原实例、原方法和原返回值记录快照耗时，并可恢复原方法，保持模型算法、版本、journal、偏移及身份契约。新增专项同时验证冻结字节和这个唯一读取例外；不通过改写Stage0哈希解除冻结。

现存DOM兼容端口宿主是显式能力的阶段过渡层，16.8在业务迁移后清除；16.4负责模板中剩余10项静态内联属性及HTML最小化，当前Menu View已移除这些属性，运行页面必须没有隐式handler。16.7负责剩余runtime文件路径。此次没有把业务全局改名挂到兼容宿主，也没有提前实施这些后续Atomic。

## 旧断言意图到当前验证

- R15冻结事件目录及43来源SHA保留。改变的生产者从目录的精确历史提交核对原SHA，当前生产者按新模块映射核对；原全局包装场景改为显式measure及pause/resume/destroy期间不改写应用函数，隐私、Buffer、Observer、Snapshot、原生确认及有界重试原场景保留。
- 原代码/表格测试仍实际调用创建出的直接编辑器并验证单次事务、取消、写回及销毁；通过Widget Lifecycle公共接口替代DOM属性。新增能力所有权、迟到调用和重复销毁场景。
- 大文档真实Windows四路继续检查原正文SHA、长度、可见正文、nativeBacked、metadata无正文副本及有界session；读取已存在的Editor接口，无模型全局。导出长文测试从修改全局模型方法改为观测实际Editor.value getter，要求同步Worker构建不读取全文；四格式及取消/过时场景保留。
- LinkPreview实际页面通过真实文档链接点击及关闭按钮验证焦点、Tab、过时隐藏及焦点恢复；不调用隐藏业务API。默认生产页同时检查无业务全局、无经典脚本、无实际内联handler。原E2E opt-in权限/DTO/销毁契约继续验证。

## 验证状态

验证进行中，未验收。首轮VM测试装载器仍匹配旧import、旧全局/DOM方法字符串断言，以及局部测试双重Recorder连接等失败已识别；修复后须完整复验，不删场景或降低门槛。生产构建已通过，主包586.77KB，原500000/700000字节预算保持；精确实现提交Windows累计CI待推送。推送后不轮询，等待用户报告。


## 最终本地验证与交付（2026-10-23）

最终全仓2737/2737，362个跟踪测试文件、16个目录，0失败、跳过或取消。新增Global API专项16/16；原浏览器契约11/11，最终生产包实际页面75/75。此前完整页面73/75的两处旧模型全局探针已迁到现有E2E只读DTO/Editor接口，文档身份、正文、事务及版本断言保持。最终全仓前又发现两项HTML生命周期源码断言仍要求已删除的无用直接destroy导入，已改为验证统一dispose入口及finally释放观察器；相关28项通过，随后完整全仓全绿。首轮Windows未从npm启动导致npm_execpath缺失及审核指纹未刷新、第二轮两项过时源码断言的失败事实保留，没有降低门槛。

生产构建通过，主包586.77KB，原500000/700000字节预算保持；来源指纹accepted=true，511个源码输入、137输出，sourceSha256=14a6ed038657c11ada42372661e36fb63bcec8b25611cf1fd2fcf551c7524fdc。当前570个生产文件一一对应，四项架构/旧运行时/生成文件/README门禁通过，195项风险源blob SHA已刷新复核；历史R12验收整体与R15冻结目录保留，当前R16-02精确验收仍为accepted。

原文件O:/Project/Markdown Rust/500万字.md为5453875字符，同量级夹具5390000字符；各通过原生IPC打开、Tauri拖放事件、浏览器File输入、切换后原生正文重开，共8条。全部正文长度/SHA一致，nativeBacked、metadata无正文副本、session小于32KB及可见编辑正文通过，控制台错误/异常均0。证据：本机Temp/mdr-r1603-native-3ThisJ/verification.json。原文原始SHA256仍为c042b1ab556d9156f22a4b81e761a6bb11861324eb762d6e2083fb98850f1032，未改写原文件。本机链路使用既有调试Tauri二进制＋最终Vite源码、独立WebView配置；拖放走真实Tauri事件传输，非OS物理拖拽。精确生产嵌入包仍待本提交Windows CI验收。

全部10项受保护指纹与R16-02一致，模型、Rust、依赖和锁文件均未修改。删除清单冻结1132个输入，104候选为37已缺席、59仍引用、6受保护、2未证明，全部deletionAllowed=false；本任务未按清单删除其他文件。专用Vite验证服务已按核验PID关闭，用户AGENTS.md修改保留且不提交。回退采用本次实现提交的git revert，基线7c2c62e，不重置用户文件。

R16-03已实现并完成上述本地验证，尚未正式验收；CI增加本项16项专项并保留全部累计验证。推送后停止查询CI，等待用户通知结果或明确要求查看，16.4未开始。


## 连续链接预览焦点引用回收

提交前复核补充：同一预览连续打开新链接时，旧FocusScope已destroy，但还留在强引用Set；现销毁后立即从拥有者集合撤销。新增tests/e2e/link-preview.test.mjs使用真实Chromium、真实DOM和实际ESM模块，连续25次打开后每次只保留一个焦点Scope，关闭后立即销毁则全部资源为0、overlay移除、晚到打开拒绝且无业务全局。撤去这一行的受控负对照被回归明确拒绝，随后恢复最终源码并复验通过。CI新增真实焦点专项，16项Global API契约及原有完整回归保持，新增场景共17项。此处是引用生命周期修复，界面及交互不变。

最终加入真实焦点回归后的全仓复验：2737/2737，362文件、16目录，无失败/跳过/取消。原生8链验证后仅补链接预览焦点引用释放及其回归，文档/导入/存储生产代码保持；嵌入生产包的精确Windows链仍由本提交CI重验。

最终补丁构建的实际页面75/75重新完整通过；新增真实焦点1/1及全仓2737/2737通过。当前交付源码指纹14a6ed038657c11ada42372661e36fb63bcec8b25611cf1fd2fcf551c7524fdc，511输入/137输出，195项风险源SHA核对；最终交付契约38/38及四门禁通过。17项新增场景为Global API16＋真实焦点1。R16-03保持待精确Windows CI验收。


## CI未通过与并发夹具修复（2026-10-24）

实现f3570af01938ff463a53a14a9f9f7acb0159ba72的[CI39979330283](https://github.com/uniquenesssta/mdr/actions/runs/39979330283)拒绝验收。前端、依赖、全仓Node、原生opener和真实WebView五组成功；Rust的Full Rust tests为285通过/2失败，最终汇总因Rust失败保持拒绝。失败为reservation_releases_mutex_and_keeps_other_documents_available（原夹具55行）及io_failure_discards_uncommitted_document_and_allows_a_retry（194行），均为recv_timeout的Timeout。多个真实IO用例同轮超过60秒；前者在实际保存线程join后才检查此前超时的结果，不能将这个超时当成缓存锁未释放的证据。R16-02至f3570af的Rust源码未变化，不据此宣称产品已修复或CI已通过。

R11-15契约要求短锁、不同文档可并行IO、同文档大小写别名串行及真实落盘一致，没有规定五秒磁盘SLA。现在只用原五秒时限等待实际保存取得占用：通过cfg(test)只读try_lock观察真实active集合，或接收已经完成的结果；随后仍join实际保存线程，检查原返回版本、独立文档落盘正文及重试后的磁盘/缓存一致。失败初次保存还检查占用已撤销、缓存未发布。大小写别名100ms互斥、同文档唤醒/poison、八线程竞争、恢复和删除原断言保留；未修改CI并行度、增加重试、延长五秒、跳过场景或改变生产锁/存储算法。真正磁盘IO仍必须完成，卡住或错误不能记为通过，整组CI继续有任务级时限。

新增两项Rust回归：真实lease已取得但结果尚未产生，以及完成结果/有界超时/发送端断开。以旧的只等待磁盘结果行为做受控负对照，新真实lease回归明确失败，恢复后通过。CI新增并发9项独立门禁，原Full Rust tests仍完整运行；修改的并发夹具使用同一Rust1.88、120列配置，并加入45路径格式门禁。cache.rs唯一修改为cfg(test)只读观察方法；生产save/checkout/drop、磁盘格式、命令、冻结模型、前端、依赖及锁文件不变。

本地Rust1.88：并发9/9；完整二进制单元288通过/1失败，新旧两项CI故障均消除。唯一失败仍为未修改的windows_case_sensitive_directory_preserves_distinct_spelling_bodies：fsutil准备返回The request is not supported。本次CI中该用例通过；保留原用例且不跳过，不能将本机完整Rust标为全绿。另独立执行文档兼容5/5、阶段12兼容6/6、原生opener链接1/1，合计12/12。Clippy全目标-D warnings、生产cargo check和精确45路径rustfmt均通过。当前Rust定义301项，本地300通过/1项环境准备失败，待新提交Windows完整验收。

本次只修复测试协调及补足CI验证，前端构建输入未变化；保留原f3570af的2737项Node、11＋75实际浏览器及WebView成功证据，不冒充新提交的完整验收。当前修复提交仍待精确CI；04未开始，推送后停止查询。回退使用本次修复提交的git revert，保留用户AGENTS.md改动和既有所有验收记录。

最终修复关联Node验证78/78，无失败/跳过/取消，覆盖存储边界、模型字节、模块清单、关闭验收、删除证据、工作流及四项项目门禁。197项当前风险源SHA已刷新；全部10项受保护源、570个模块集合、1132个删除证据输入及104候选分类保持，全部deletionAllowed=false。当前前端来源指纹仍为14a6ed038657c11ada42372661e36fb63bcec8b25611cf1fd2fcf551c7524fdc，未重建或重跑未受影响的产品浏览器/大文档链。Rust完整本机288＋12通过、1项环境准备失败的限制和新提交CI门槛保持。
