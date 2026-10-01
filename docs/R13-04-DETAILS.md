# R13.4 Drop Import

状态：实现已提交，**待精确提交 Windows CI，尚未验收**。唯一分支 `agent/r13-stage`。前置/回退代码基线为 R13.3 `76735b48ddc83e9396ed3df9db91b9f82e82dac1`，Windows CI 36821916874 七个 job 成功。

## 实际职责与入口

新增 `files/drop-import-controller.js`，通过 Import 公共入口导出。它独占 browser dragenter/leave/over/drop 监听、嵌套计数、overlay 可见性命令、native 订阅、首项选择、类型路由与请求代次。分类直接调用同 Feature 的纯分类器，不读正文、Data URL、大小，不创建文档、不操作 editor/overlay DOM。

main 注入 document、平台能力及 `platform.dragDrop.subscribe`。经典 events 通过 scoped `classic-drop-import-port.js` 一次注册文本/图片/提示/遮罩命令。旧 events 的拖放监听、计数、分类分支和 native 订阅已删除；`classic-import-classifier-port.js`、公共导出、main 挂载销毁与生产清单条目同步删除。保留 `handleNativeDroppedPath` 为现有文件选择、最近文件、启动路径的薄入口，统一转到新路由，不保留第二套分类实现。

## 生命周期与兼容

- 浏览器与 Windows 均只选首项；desktop dragDrop 能力启用时忽略 DOM drop 的文件，防重复。路径 trim、文本优先/MIME-only 差异、5 MiB 警告、原生图片规则与成功后登记最近文件保持。
- enter 增计数，leave 归零下限，drop/原生离开重置遮罩。destroy 移除四个 DOM 监听并隐藏；旧事件回调失效，重复 destroy 无额外副作用。
- native 订阅先于/晚于 destroy 完成都释放 disposer；订阅或释放失败仅由注入诊断出口记录，不产生未处理 Promise rejection。平台自己的 disposer 仍负责底层幂等释放。
- 后续导入/销毁使旧 request.isCurrent 失效。浏览器/Windows 文本 loader 在正文交给 Documents 前检查代次；图片读取完成后检查代次，旧结果不得插入/提示/登记最近文件。Documents 原有代次检查继续生效。
- 为完整封住本次拖放回调，旧浏览器图片命令增加 error/abort 与读取完成后的处理器清理；原先失败未处理的图片现在显示读取错误，abort 静默结束。未迁移图片对话框或改变大小政策。

R13.5 将剩余 overlay classList 回调迁入纯 View；R13.6/13.7 负责图片政策/读取与底层取消（本项销毁阻止晚到结果，不声称物理中断所有图片/原生 I/O）；R13.13/13.14 删除 scoped Drop/File Import 兼容桥及剩余经典命令实现。新桥只传命令，不复制路由/文档状态，不创建 window 全局。

冻结模型、Rust、持久化格式和依赖均未修改。A05/R13-S01 仍先于 13.9；A03 网页来源安全回归与 A10 后续解析依赖复核保持原任务归属。

## 验证及旧断言映射

- 新增 Drop Import 契约：嵌套计数与归零、首项与不读内容、DOM/native 去重、路径分类、同步/异步订阅失败、晚到订阅释放、清理失败、过时命令/销毁、桥接重复挂载与终态、旧模块删除。
- 原导入矩阵改为真实 Drop Import + File Import 控制器与 events 命令联调，所有原支持类型、阈值、失败、最近文件顺序保留；追加浏览器图片 error/abort/晚到、原生图片晚到、文本交给 Documents 前的取消回归。
- 13.2 被删除分类桥的生命周期测试迁到新 Drop 桥（同样覆盖重复挂载、销毁、重挂载），纯分类测试全保留。平台 tests 中 events 内联 native 订阅/分类位置断言改为 main 注入 → Drop Import 分类/事件路由，平台只搬运路径、文本/图片端口及 MIME 断言保持。
- 新增 Windows Chromium E2E：真实 DOM 冒泡 DragEvent/DataTransfer/File、嵌套 enter/leave、首文件与 MIME 路由、遮罩重置和 destroy 后无监听副作用；既有 FileReader、Documents、原生/WebView 回归继续运行。

本地仅 `node --check`、JSON/模块清单、引用与差异静态复核，不运行 Linux/macOS 产品测试。全部真实行为仍须现有 Windows CI；启动后结束、不轮询，成功前不勾选 13.4，不开始 13.5。跨模块生命周期使用 Mermaid Chart 复核；未新增第三方 API 或依赖版本。
