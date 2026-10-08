# R14-03 导出任务控制器

状态：**已实施，待本提交七组 Windows CI，不标验收**。2026-10-09 用户要求“收尾02开始03”；前置 R14-02 在 `b85f74cfa6766407de3f72b193a349e87e7f606f` / [CI37807608820](https://github.com/uniquenesssta/mdr/actions/runs/37807608820) 七组与全部步骤通过，最终同提交汇总成功。全仓16目录1686/1686、前端688/688、请求31/31、原导出基线41/41、浏览器11/11＋34/34，正式收尾；详见 [R14-02](R14-02-DETAILS.md)。继续唯一 `agent/r14-stage`，14.4及后续项未验收。

## 任务职责与完整接入

`src/features/export/application/export-task-controller.js` 唯一拥有任务编号、active task、progress/message、cancelable、cancelled和阶段。公开入口 `src/features/export/index.js` 返回实例控制器、冻结任务句柄与冻结快照；没有 DOM、模型、平台、渲染器或文件 I/O。工作阶段由调用者报告为 preparing/building/enhancing/serializing/printing/loading/images/encoding；结束状态为 completed/failed/cancelled/replaced/destroyed。

| 路径 | 行为 |
| --- | --- |
| begin | 新任务使旧可取消任务失效；旧任务标记cancelled/replaced；编码锁定时拒绝新任务且不增加编号 |
| update/setCancelable | 只接受当前未取消任务；旧、结束、取消和销毁后的句柄不能更改进度、阶段或按钮 |
| cancel | 控制器决定是否可取消；有效取消发布0进度和取消消息，晚到进度被拒绝 |
| finish | 只清理本实例当前任务；伪造/其他实例/旧任务无法关闭新任务；记录完成、失败或取消 |
| subscribe | 界面只投影快照；通知覆盖全部订阅者，重入替换不会在新快照后重放旧快照 |
| destroy | 即使任务锁定也使句柄失效、清空active并通知关闭；释放全部订阅；新任务与新订阅被拒绝 |

`compatibility/classic-export-task-port.js` 只拥有非枚举、不可写的主机属性与订阅卸载，不复制任务状态。`src/main.js` 创建唯一控制器并挂载端口；pagehide先销毁控制器以关闭进度，再移除订阅和请求/任务端口。关闭投影报错仍继续其余主入口清理。已卸载端口的晚到finish返回false，不启动新任务。

classic中的任务编号、active变量、取消类和任务对象实现已删除。现有 Word/HTML/PDF/图片预览、完整内容构建、增强与图片准备全部消费公开句柄；内联取消按钮只发cancel命令。classic仍有无业务状态的begin/finish/cancel调用适配及DOM进度投影，明确由14.5迁出、14.18随旧调用者拆除，未保留第二份任务权威。Markdown/右键Markdown/图片下载原先没有进度任务，本项保留其请求校验和原读写入口，后续统一Export调用迁移仍按任务书推进。

异步图片库加载、完整内容返回、保存对话框和写入返回、PNG编码返回均检查句柄有效性；替换后的对话框不能再发起写入，销毁后的PNG结果不能修改预览或成功提示。已发起的原生写入不能由纯JS控制器撤销，本项不宣称阻止已经提交的写入；14.4取消职责与14.8写入职责继续负责该边界。PDF视图初始化异常与恢复异常也释放任务；现有80ms打印、1200ms恢复及afterprint算法保留，独立打印生命周期迁移仍属14.12。

打开模态框失败会回滚active并发出关闭；关闭失败不保留活动任务。classic调用适配将开/关错误展示为提示，纯控制器保留原错误供直接调用者处理。

## 原目的到公开所有权映射

14.1 `contracts.json` 和14.2 `requests.json` 输入原样保留；原41项导出基线、31项请求回归的active/任务编号断言迁到 `exportTaskPort.getSnapshot()`，任务替换、取消、进度钳制、编码锁定、无产物与PDF恢复场景继续执行。没有恢复退休Preview全局、跳过场景或降低门禁。

新增 `tests/stage-14-export-task.test.mjs` 直接验证独立实例、不可变句柄/快照、真实阶段、旧任务与伪造句柄、通知重入、打开回滚、关闭异常、订阅与销毁。真实classic源配合真实控制器验证按钮/过时清理、晚到图片库、锁定PNG与销毁结果、HTML/Word晚到对话框以及PDF异常释放。VM平台/DOM/vendor替身仍只证明编排，不冒充原生I/O或实际格式产物。

实际built-app新增两项：真实任务端口→ModalShell进度/取消按钮→替换/锁定/清理；最后经真实pagehide验证锁定任务失效、界面关闭和端口卸载，产物为 `r14-03-task-controller.json`、`r14-03-task-disposal.json`。此前四种渲染格式断链、长文缺口、锁定数学/Mermaid与可解码PNG正控继续验证。

F01/F02/F04及A10继续未修复；F03请求命名已通过14.2，但14.9/14.10/14.11仍须验证完整格式产物。14.4取消token与14.5独立UI不因本项接入而勾选。A10仍必须在14.7验收前处置，R14整体收官不得遗留。

## 验证与回退

复用七组Windows流程，增加任务控制器专项步骤，保留全仓递归Node、前端、构建、契约/实际浏览器、Rust、原生、官方依赖、真实WebView及最终同提交汇总。生产清单登记两个新所有者，当前风险源指纹更新；R12历史验收及R13/R14.1证据保留，另登记14.2验收。

本地11个变更脚本和7个嵌入实际页面表达式语法、四项静态门禁、100个相对链接、JSON/YAML配置、41项当前风险源指纹、历史验收/原夹具及diff检查通过；产品测试与构建只在Windows执行，待新CI，14.3暂不勾选。无模型、依赖、Rust命令或持久化格式变化。回退限本项任务模块、主入口/调用者接入及相应测试与文档，保留14.2已验收请求策略。

已通过Mermaid Chart记录实际任务所有权、替换、锁定及pagehide销毁链。启动Actions后结束会话，不轮询；约15～20分钟后查询。
