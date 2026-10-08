# R14-01 导出格式行为夹具

状态：**夹具与现状失败基线已实施，待本提交 Windows CI，不标验收**。2026-10-08 用户要求“收尾14开始R14-01”，从13.14收尾验收提交 `4340398e220e729ae7c5912cbdfbc20513031ce4` 创建唯一分支 `agent/r14-stage`。本项不迁移产品导出实现，不修改冻结模型、依赖、Rust命令、持久化格式或历史验收快照。

## 前置验收与阶段边界

13.14 实现提交 `9c62844` 已在 CI37751356061 正式验收。本轮再次核对收尾提交 `4340398` / [Windows CI37792105001](https://github.com/uniquenesssta/mdr/actions/runs/37792105001)：七组及全部执行步骤成功，最终日志明确同提交 Windows 证据汇总通过。

| Windows 证据 | Job ID | 结果 |
| --- | --- | --- |
| 真实Windows WebView导入与安全链 | 113361918104 | success |
| 前端、构建、浏览器与静态门禁 | 113361918171 | success |
| 官方RustSec与Windows依赖图 | 113361918210 | success |
| Rust全套累计硬门禁 | 113361918238 | success |
| 原生编译与链接 | 113361918359 | success |
| 全仓递归Node | 113361918407 | success |
| 同提交证据汇总 | 113365894757 | success |

[收尾产物](https://github.com/uniquenesssta/mdr/actions/runs/37792105001/artifacts/11557586586) ID11557586586，SHA-256 `bcf8071b46c13388852a9e123b0ee9a141047bf58c517f9c05ba65f8192065a3`；真实WebView产物ID11557910359，SHA-256 `954b45f75a9e3fad97dd7587de4e502b61aa97440c2109421e67f6a68d6469f9`。

13.1～13.14实现项验收保持，但A10新KaTeX/Mermaid低危风险仍未修复，R13整体安全收官未标完成。本次根据用户明确启动指令仅进入14.1基线，具体顺序裁定见 [全局§0](markdown-main-full-rewrite-taskbook-18-docs/01-全局架构规划与基线冻结.md)。A10转入 [R14任务书](markdown-main-full-rewrite-taskbook-18-docs/15-阶段14-导出完整重写.md)，14.7增强迁移验收前必须取得处置与Windows证据，R14整体收官不得遗留。

## 真实入口审计结果

当前Menu命令仍通过classic adapter调用 `public/app/export.js`。Markdown直接读取模型快照；HTML/Word/PDF/Image进入旧完整文档构建。该构建还读取已删除的 `previewWorkerClient`，后续又依赖已删除的 `createPreviewNodesForBlock`、`styleTaskLists`、`renderMermaidBlocks` 和 `observedPreviewBody`。第一处会抛 `ReferenceError`；HTML/Word/PDF/Image捕获后没有产物。只检查源码存在或向VM补齐旧全局会掩盖实际断链。

| 发现 | 当前行为与证据 | 接收职责与完成门槛 |
| --- | --- | --- |
| R14-F04 | 实际四种渲染格式因退休预览全局变量失败；源码、无补齐VM和built-app探针分别固定 | 14.6/14.7迁到公开端口，14.12/14.16真实打印恢复与PNG全链通过；禁止恢复旧全局 |
| R14-F01 | 完整内容构建后的HTML/Word路径未调用增强；旧算法输出仍是数学原文/Mermaid代码 | 14.7/14.10/14.11取得真实数学与图表格式产物 |
| R14-F02 | HTML模板仍引用KaTeX0.16.9 CDN，并在独立页面引用应用内部变量 | 14.10离线独立页面执行及正常内容证明 |
| R14-F03 | 非Markdown后缀被再次追加，HTML/Word可能出现双后缀 | 14.2/14.9/14.10/14.11明确统一命名契约与前后映射 |
| A10 | 锁定KaTeX/Mermaid新low风险未处置 | 14.7之前作兼容升级或完整处置决策；HTML/Word/PDF/Image补齐离线完整链，阶段末不得遗留 |

这些是已登记的缺陷基线，不是应长期保留的兼容要求，也不因夹具CI通过标成修复。相应重写项须保留原记录并明确新输出对照；新增失败、缺少产物或新异常继续阻止相关任务验收。

## 夹具与验证边界

`tests/fixtures/stage-14-export/contracts.json` 固定中文/emoji、表格、任务列表、代码、行内/块数学和Mermaid源，六组名称、四种文件保存过滤器/目录、137块/400000字符分批边界、五种图片比例及缺陷接收表。输入没有远程图片；导出模板中的历史CDN只记录、不加载或执行。

`tests/stage-14-export-characterization.test.mjs` 和 `tests/support/export-vm-host.mjs` 执行未修改的实际classic源。一个无旧绑定场景明确复现断链；其他隔离算法场景显式提供旧预览绑定，验证文件名/转义/过滤器/目录、取消/写入错误不回退下载、原文快照、旧HTML/Word模板、同步块按48/96分批、旧块版本回退、解析错误原文保留、取消后无晚到块或产物、任务互斥与进度、PDF afterprint/超时恢复、PNG尺寸/裁切/不可取消阶段和编码。DOM/平台/vendor替身只证明历史编排算法，不证明当前应用渲染或真实Windows文件保留。

`tests/e2e/lib/export-characterization.mjs` 加入既有built-app入口，新增四类探针：

1. 经真实Documents导入夹具，捕获实际Markdown下载Blob、原文字节、六组文件名及URL释放；HTML/Word分别断言真实缺失预览变量错误、无文件及进度释放。
2. 导入超过400000字符、137段的本地长文，记录实际完整构建的同一断链，不接受可见预览或部分文本作为完整产物。
3. 经现行公开Presentation端口运行锁定KaTeX/Mermaid，并用真实dom-to-image生成可解码320×240 PNG，保留DOM统计、PNG字节和产物。这是独立能力正控，不冒充旧导出器成功。
4. 实际PDF/Image调用失败且不打印、不新增图片，记录视图和进度状态。当前打印设备/PDF文件不是本项已验证结果；恢复算法由隔离VM固定，真实完整恢复在14.12验收。

VM不代替真实文件I/O，原R12安全写入与WebView回归继续执行；A06所有格式实际安全写入失败验证仍在14.17。无需新建生产Export目录或临时桥接，14.2以后按职责逐项实现。

## CI与静态复核

复用 `.github/workflows/r12-14.yml` 七组Windows流程，只将自动分支改为 `agent/r14-stage`、增加R14文档触发与定向夹具步骤，保留递归Node、前端、契约/实际浏览器、Rust、原生、官方依赖与最终同提交门禁。原“当前R13分支”断言仅改为R14唯一分支及新夹具路由，原Windows/禁止历史多平台调度目的保持。

本地五个变更脚本与四个嵌入浏览器表达式语法、架构/无旧运行入口/生成文件/README四项门禁、116个相对链接、35项当前风险源blob、历史快照/产品零变更和diff静态复核通过；不在Linux/macOS执行产品测试或构建。Windows产品/浏览器/PNG与累计结果等待本提交CI，不借前置成功标14.1通过。启动Actions后结束会话，不轮询，约15～20分钟后查询。

使用Mermaid Chart梳理真实现行导出链；无新第三方API/版本变更。本项回退只移除新增夹具、浏览器探针与R14路由记录，不涉及用户数据或模型迁移。
