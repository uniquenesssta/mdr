# R14-04 导出取消机制

状态：**已实施，待本提交七组 Windows CI，不标验收**。2026-10-09 用户要求“收尾03开始04”。R14-03 在 `751f012f8aab277d7b7dbcbe26b2cff0f8801ff2` / [CI37818046855](https://github.com/uniquenesssta/mdr/actions/runs/37818046855) 七组及全部步骤成功，同提交证据汇总通过；全仓16目录1702/1702、前端704/704、任务16/16、请求31/31、原导出基线41/41、浏览器11/11＋36/36。详见 [R14-03验收](R14-03-DETAILS.md)。继续唯一 `agent/r14-stage`，14.5未开始。

## 取消职责与完整调用链

按任务书将唯一任务控制器归入 `task/export-task-controller.js`，新增同目录 `export-cancellation.js`，公共入口仍为 `src/features/export/index.js`。旧application路径删除，当前风险清单转到新路径，旧源指纹和已验收记录保留。没有新增第二套控制器、任务编号或取消状态。

Task Controller仍唯一拥有active/cancelable/cancelled/phase。Cancellation提供只读token、取消错误和非取消阶段策略；token实时读取所属任务状态，不缓存第二份权威状态。每个任务返回冻结的 `task.token`，携带taskId及 `cancelled/reason/throwIfCancelled/onCancel/waitFor`；下游只持能力，不获得cancel或解锁方法。取消、替换、完成、失败、销毁使token失效，保留原错误名称与 `EXPORT_CANCELLED`，另给明确reason。

| 原目的或入口 | 本项替代契约与保留覆盖 |
| --- | --- |
| task.throwIfCancelled与task.cancelled轮询 | 统一task.token检查/谓词；任务和快照只读状态继续由控制器提供 |
| setCancelable(false/true)任意切换 | lockCancellation(phase)显式锁定writing/encoding/printing，锁定后不能解锁或改阶段；任务结束后下个任务重新可取消 |
| 分帧/图片库/增强/图片请求/保存对话框等待 | token.waitFor在失效时立即拒绝等待并清理订阅，底层晚到成功或失败被观察且不发布 |
| 原生文本写入和浏览器HTML/Word提交 | 选择路径后、提交前检查并锁定writing；已提交写入拒绝普通取消/替换，避免假装撤销文件操作 |
| PNG编码 | 编码前锁定encoding；普通取消被拒绝，销毁仍使等待和结果失效 |
| PDF准备 | token覆盖准备与增强，打印交接前锁定printing；既有80ms/1200ms和afterprint恢复保持，完整打印生命周期仍由14.12接收 |
| UI取消 | 现有按钮仅调用端口cancel；界面消费冻结快照，不写任务或token，不获得解锁方法 |

控制器发布失效时，token只负责一次性订阅及等待清理。订阅卸载幂等，已失效token可立即通知而不向销毁的控制器注册监听；等待完成或取消均释放监听。取消观察者报错仍继续通知其他等待者；底层操作拒绝即使晚于取消也有处理器，不形成未处理拒绝。

经典构建、增强、图片库、图片准备、HTML/Word保存与PNG返回全部迁到token。图片加载取消后清除onload/onerror，晚到旧回调检查token后不能改写旧图片；网络加载本身及已提交原生写入/编码没有可撤销能力，本项只中断应用等待、阻止晚到状态和DOM发布，不宣称撤销系统已提交的操作。原生写入继续使用已验收安全文件端口。

classic仍只投影进度DOM和调用公开命令，由14.5/14.18迁出；Markdown、右键Markdown和已生成图片下载的原有无进度任务入口保持，完整格式/调用Controller重写按后续Atomic执行。F01/F02/F04及A10未修复，F03请求命名已验收但完整产物仍待14.9/14.10/14.11；没有恢复退休Preview变量。取消专项通过不能代替实际HTML/Word/PDF/Image产物验收。

## 验证与边界

保留14.1原始格式夹具、14.2请求映射、41项导出基线、31项请求和16项任务场景。原“解锁后取消”明确改成“锁定任务先结束，再验证下一个可取消任务”；保留互斥、编号、旧进度/按钮/清理及取消检查，不降低原验证目的。handle检查迁到token，错误名称保持。

新增 `tests/stage-14-export-cancellation.test.mjs`：冻结能力与独立实例，五类失效/通知/晚到拒绝，订阅清理/观察者错误/等待原错误，三种不可逆锁定；实际classic源覆盖未完成帧、图片库、图片回调与占位符、数学/图表增强、HTML/Word等待和实际提交锁定、锁定通知期间销毁、PNG失败后的下一任务。VM仍是编排验证，不冒充原生I/O或完整格式产物。

built-app保留先前七类导出探针，增加真实取消按钮→token等待立即结束→无晚到DOM发布，产物 `r14-04-cancellation.json`。原实际pagehide探针同时验证锁定任务的等待拒绝和晚到编码错误被处理；原锁定/取消按钮探针显式映射不可逆边界。实际探针是能力与界面链，不宣称真实格式写入成功。

复用七组Windows流程，新增定向取消步骤，其余递归Node、前端、构建、契约/实际浏览器、Rust、原生、依赖、真实WebView和最终同提交门禁全部保留。当前源审阅补齐迁移与取消模块，R12根验收与历史R13/R14验收保留。无模型、依赖、Rust命令或持久化格式变更。

本地10个变更脚本和8个嵌入页面表达式语法、四项架构与文档门禁、104个相对链接、JSON/YAML、42项当前源指纹、历史记录及diff静态复核通过；产品测试和构建只在Windows执行，14.4待新CI，暂不勾选。回退限本项task目录迁移、取消API及调用者/测试/文档，保留14.3已验收唯一状态所有权。已用Mermaid Chart记录实际取消/锁定链；启动Actions后结束会话，不轮询，约15～20分钟后查询。
