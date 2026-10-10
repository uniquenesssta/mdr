# R14-09 Markdown Exporter

状态：**实施完成，待精确提交 Windows 累计验收**；14.9不勾选，14.10未开始。继续唯一分支 `agent/r14-stage`，基线为08正式验收提交 `22cbd6820ef2703ff1252110f70c71bb6a201114` / [CI38072508148](https://github.com/uniquenesssta/mdr/actions/runs/38072508148)。

## 08收尾

08七组及全部步骤通过：全仓1848/1848（334文件16目录）、前端843/843、Styles21/21、启动生命周期12/12、导出/请求/任务/取消/进度43/31/16/22/20、Builder21、增强27、安全6、Settings5、浏览器11/11＋45/45、Rust281和真实Windows导入8/8。四份归档摘要与提交一致，最终accepted=true；浅深色1080×2355 PNG参考零差异与可见文本正控通过，本提交两张PNG已视觉核对。Preview/Hybrid真实两公式原节点及可访问裁剪通过。首轮失败、未确定的首次无窗口底层原因及修复事实保留，见 [08证据](R14-08-DETAILS.md#正式验收2026-10-11)。

## 唯一原文导出所有者

`src/features/export/formats/markdown-exporter.js` 由Export公共入口导出 `createMarkdownExporter`；所有依赖由main注入。它仅负责原文快照/读取、不可变元数据、任务与输出编排，不依赖Parser、Worker、Builder、Enhancer、Styles、Preview DOM或编辑器可视文本。

| 原入口 | 公共调用与保留语义 |
| --- | --- |
| 菜单/工具栏`exportFile()` | 先沿用14.2请求校验，再转发`export({request})`；活动模型`createSnapshot('export-markdown')`，成功通知保留 |
| 文档右键`exportContextDocument(id)` | 公共Documents读取所选记录/title，转发`export({request,snapshotReason:'context-export'})`；未传id使用当前文档 |
| 当前文档右键 | 直接活动模型快照，保留`context-export`原因；不用可视editor.value回退 |
| 非当前文档右键 | `Documents.readDocumentContent(id)`，保持活动身份、内容与模型版本，不为了导出而切换文档 |
| 浏览器原文输出 | 既有Platform `files.writeText`以Markdown MIME创建Blob；既有下载adapter在成功或click失败时移除anchor并撤销URL |
| Windows原文输出 | 既有Platform保存对话框与安全`files.writeText`；R12-21安全写入算法、权限和后台命令保持 |

删除`public/app/core.js`内旧`exportMarkdownContent`及原文快照/读写算法；经典文件只保留请求/通知的薄调用，不保留第二份Markdown权威实现。HTML/Word仍使用其现有文本输出编排，统一格式File Writer归14.17实施；本项没有创建另一套文件替换算法。作用域`classic-markdown-export-port.js`只管理冻结命令与宿主属性，随经典调用者于后续阶段删除，不向window增加业务API。

沿用14.2文件名规则与原始14.1→14.2映射：正确.md/.markdown保留，其他已知格式后缀替换为.md，非法Windows字符/保留名/长度校验在任务前；目录和名称在任何异步读取/保存等待前脱离调用方输入。标准化请求的非图片`imageOptions:null`在重新校验时映射回无图片选项，其他格式与非法身份仍拒绝。原始夹具不变，F03的Markdown完整输出由本项验收，HTML/Word完整输出仍由14.10/14.11接收。

## 取消、过时与销毁

唯一Task Controller在输入合法后创建Markdown任务；可替换/取消阶段包括非当前文档读取与保存对话框。开始前、快照后、异步读取/保存后和不可取消锁定前后检查原始Documents generation、活动身份、记录存在性，以及活动快照的原始模型版本。读取返回的generation也必须有效。切换文档、删除记录、修改活动内容或同步进度监听器重入均不能发布过时原文。

等待使用已验收的取消令牌，并由Exporter独立持有销毁拒绝信号。销毁会立即结束自身等待，迟到读取/对话框/写入失败被观察，无晚到文件/成功通知；桥接销毁只卸载自身，不销毁Exporter或其他宿主属性。main在Document Controller/模型销毁前释放Exporter与端口，pagehide逐项释放即使其他清理报错仍继续。

保存对话框null/空路径为取消，既不写入也不回退浏览器；读/选/写错误保留原错误，不伪造成功。实际写入/下载前锁定`writing`，既有取消按钮与新任务不能打断已发出的不可逆输出。销毁或文档改变发生在已经发出的安全写入期间时，外部写入由原平台继续完成，本owner只拒绝晚到结果，不承诺撤销文件、不重试。finally只结束自己的任务，旧任务不能清掉替代任务。

## 验证映射与 Windows 门槛

新增30项契约，涵盖两平台空文档/BOM/CRLF/Unicode/大原文、所有原文件名与目录/过滤器、任务前拒绝、当前及非当前来源、读取/选路径的取消/替换/销毁和迟到失败、generation/身份/版本/删除与锁定重入、null/非法路径、写入锁定/竞争、进行中销毁、错误身份/清理、缺失能力、真实浏览器adapter的click失败URL清理与作用域桥接。

原43项格式与31项请求场景保留；VM改为真正公共Markdown Exporter＋既有browser download，不再注入旧下载实现。原非当前文档读取的过时场景在读取过程中改变generation，仍要求读取一次且不得打开保存对话框；同步任务前过时与异步过时另有明确覆盖。旧Markdown不属于任务编排的实现变为统一任务/进度，原命名、字节、MIME、取消无回退与通知语义保持。Blob BOM验证比较UTF-8实际字节，不用会去掉BOM的文本解码冒充完整原文验证。

原45个built-app场景保持，新增3项为48：

1. 真实活动模型的空文档、数学/图表/原始标签和大文档，两个入口实际Blob字节逐一等于模型快照；原Preview节点不替换，名称/MIME/URL与任务释放核对。
2. 实际Documents创建并持久化非当前来源，通过公开文档右键命令输出正确原文与名称，当前模型身份/内容/版本保持，finally恢复与关闭测试记录。
3. 实际任务进度回调在写入前改变模型，必须零文件；下次原文导出完整成功。最终pagehide场景增加Markdown端口卸载与迟到调用拒绝。

工作流新增`markdown-exporter.log`，保留七组Windows、所有历史目标回归、真实WebView安全/导入与R12-21十八项安全写入（目标占用、写/替换故障、旧文件保留与临时文件释放）；不改变现有准入条件。新契约和实际页面尚未在本环境执行，其通过状态只由新Windows精确head确定。

## 静态复核与接收边界

本地仅运行架构、退休运行时、生成文件、README记录静态门禁与脚本/嵌入表达式、JSON/YAML、相对链接、风险指纹、冻结文件/夹具/历史保持和diff复核。没有运行本地产品Node测试、浏览器、构建或Rust。模块清单由525增至527，风险源由52增至54，新增owner与端口，原路径保留；更改指纹单独记录旧值。静态最终结果补在下方。

Context7核对项目已锁定Tauri2保存对话框filter与Promise<string|null>取消语义，并结合当前Platform Dialog Client/文件客户端与browser adapter代码核对；无依赖或权限变化。Mermaid Chart显示当前真实中文原文来源、公共端口、任务/身份屏障、平台输出与销毁链。启动本提交Actions后结束会话，不轮询，约15～20分钟后查询。

14.10/11离线字体/独立HTML模板、14.12打印隔离、14.16图片完整节点/资源释放、14.17统一格式File Writer与A10最终完整离线格式门槛保持。独立Editor指标错误开放；R12及此前阶段验收/失败历史保持。14.9尚未验收，14.10未开始。

最终静态复核：四项门禁通过；10个新增/修改脚本、23个实际页面嵌入表达式与5段共享CSS语法通过，6个本地令牌保持。JSON/YAML、136个相对链接、54项风险源指纹、9个冻结及20个其他受保护文件字节保持、R12根历史/阶段历史前缀/08首轮失败与修复保持、diff复核通过。新30项契约与48项实际页面未在本地执行，待Windows验收。
