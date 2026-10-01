# R13.3 File Import

状态：实现已提交，**待精确提交 Windows CI，未验收**。唯一分支 `agent/r13-stage`；前置及回退代码基线为 R13.2 `8da99a8ee8f88f67f4b44140922700e33b517f0e`，Windows CI 36809102374 七个 job 成功。

## 职责与调用链

新增 `files/file-import-controller.js`，由 Import 公共入口导出。注入浏览器文本读取与 Platform FilesPort 读取函数；返回冻结的 `{ kind: 'text', name, filePath, content }`，空文本合法，非字符串结果拒绝。保留正文及 CRLF，已有 Documents 导入入口继续负责转换、长度校验、保存当前文档与创建新文档。

浏览器文件选择/文本拖放 → scoped File Import port → controller → BrowserFileReader；Windows 文本路径 → 同一 controller → `platform.files.readText`。旧 export 中的 FileReader 文本读取被删除，events 的直接文本读取改为统一结果。读取保持 lazy，先由 Documents 命令建立操作代次并保存当前文档，再读取；读取失败不得创建空文档，只有成功打开才登记最近文件。

浏览器 FileReader adapter 增加可选 AbortSignal 和错误文案配置；原 readText/readDataUrl 调用兼容，原始读取错误继续传播，原浏览器失败/取消提示保留。File Import 自身主动取消使用 `FILE_IMPORT_CANCELLED`，由旧入口停止提交和提示；后继导入、cancel、destroy 均使待定 promise 立即失败，清除监听器，拒绝晚到结果。Windows FilesPort 没有底层取消参数，本项不宣称中断 Rust I/O；只隔离取消后的完成/失败。文档切换造成的过时由现有 Documents generation 拒绝。

`classic-file-import-port.js` 只暴露两种读取命令，无文档/UI/读取状态副本；main 在经典脚本前挂载，pagehide 与启动失败时先销毁 controller，再销毁桥接。13.13 完成导入到 Documents 的 ESM 链时删除该桥接，13.14 检查无消费者残留。13.2 分类桥接仍按 13.4 删除。

本项不改冻结模型、Rust、持久化格式、支持类型、图片大小/确认规则、网页策略或依赖；A05/R13-S01 仍先于 13.9，A03 网页渲染回归仍归 13.10/11/13，A10 无新增解析或依赖能力。

## 验证与断言迁移

- 新增 root File Import 契约：统一结果、空文本、错误恢复、取消/替换/销毁、晚到成功和失败、未启动即取消、scoped 端口生命周期、生产入口接线。
- 原导入矩阵改为调用真实 Import controller/BrowserFileReader adapter，保留支持类型、读取成功/失败/abort、首文件、警告及最近文件顺序断言。
- 两项平台测试的“events 直接读取 files”断言改为“events 调 Import，main 注入 files.readText”；平台分类隔离、图片读取及 MIME 边界断言保留。
- BrowserFileReader 单测补充 signal 取消、清理、预取消及成功后不再 abort；Documents 测试调用真实 session/controller/load-controller（model/repository 为既有测试替身），覆盖失败不建档、成功创建、取消/切换后不提交旧正文。
- 新增 Windows Chromium E2E 使用真实 File 和 FileReader，验证 Unicode/CRLF、空文件、真实 abort 与 controller destroy。原 Windows 原生/Rust 文件回归继续运行；不将注入 reader 测试称为真实 Windows I/O。

本地仅 `node --check`、JSON/生产清单/差异静态核对，不运行 Linux/macOS 产品测试或构建。行为与架构、浏览器、原生、Rust、依赖及汇总由现有七组 Windows CI 验证，CI 启动后不轮询；13.3 成功前不勾选，不推进 13.4。

新 Web API 用法已通过 Context7 的 MDN 文档核对 FileReader.abort/readyState 与 AbortSignal 清理；跨模块调用链已使用 Mermaid Chart 复核。

## 首轮失败与修正（2026-10-01）

`e32b30411d5f8ab6e2cd9496f586be2799fc5ea4` 的 [Windows CI 36814310322](https://github.com/uniquenesssta/mdr/actions/runs/36814310322) 未通过。唯一测试失败为 `tests/unit/platform/file-system-client.test.mjs` 中仍要求 events 直接 `call('files', 'readText')` 的旧接线断言。该测试同时被前端与递归 Node job 执行，产生两个失败 job；收官 job 因上游失败被阻断。Rust、原生链接、实际 Windows WebView 与依赖公告四个 job 成功。

根 Node 553/553、架构 372/372、浏览器 E2E 9/9（含真实 FileReader 读取/取消/销毁）成功，新增 Documents 读入成功、失败不建档及过时代次测试均通过。上轮迁移了同类 drag-drop/platform-cutover 断言，但漏掉此 FileSystem 文件，属于测试迁移遗漏。

修正映射：旧“events 直接调用 FilesPort 文本读取”改为“events 调用 File Import.readPath，main 注入 platform.files.readText”。原 FileSystem 不含文档/Toast 行为、Rust 命令参数/错误/DTO、图片读取及 MIME 断言全部保留。检查同类引用，其他两处已在 R13.3 迁移；平台自身 readText 契约仍有效，不作无关修改。未修改生产代码、未跳过测试或降低 CI 门禁。本地仅语法和差异静态复核，修复提交仍须完整 Windows CI；13.3 保持未验收，不推进 13.4。
