# R13.2 导入类型分类器

状态：**实现已提交，待本轮精确提交 Windows CI；尚未验收**。唯一分支 `agent/r13-stage`。前置 R13.1 已在 `3c299591b11dda238b212be68c9b6beb5b8a7726` / [Windows CI 36801548407](https://github.com/uniquenesssta/mdr/actions/runs/36801548407) 验收（7/7 job、Node 1513/1513、Rust 268/268）；该提交也是本项回退代码基线。

## 实际变更与公共契约

- 新增 `src/features/import/files/file-type-classifier.js`，通过 `src/features/import/index.js` 公开冻结的 `IMPORT_KINDS`（text/image/unsupported）、`classifyBrowserFile(file, { imageOnly })`、`classifyImportPath(path)`、`classifyImportResult(result)`。仅检查元数据，不读取内容、大小或平台能力，不持有状态，无异步或销毁资源。
- `public/app/events.js` 浏览器拖放与 Windows 路径路由改用同一个分类器，删除原扩展名数组、MIME 判断与重复分类代码；首文件、原读取调用、错误提示、最近文件登记和文档创建顺序保持。
- `src/features/editor/ui/image-dialog-view.js` 通过 Import 公共入口调用 MIME-only 分类，保留图片对话框与普通拖放不同的优先级。没有侵入 Import 内部路径。
- 新增 scoped `classic-import-classifier-port.js`，由 `src/main.js` 在经典脚本加载前挂载，pagehide 和异步启动失败时销毁；重复挂载拒绝，销毁幂等，旧 API 销毁后拒绝调用。端口只转交纯分类，无文件读取/状态副本，也不创建 window 全局。13.4 完成旧拖放调用者迁移时删除此桥接，不扩展为导入 service locator。
- 生产模块清单精确追加三个新模块；原模块、冻结模型、Rust、持久化格式、依赖锁文件与权限均未修改。Windows 工作流只更新本项显示名，原七个任务与失败门禁保持。

## 兼容边界

| 输入 | 分类规则 |
|---|---|
| 浏览器 drop File | md/markdown/txt 名称优先，扩展名忽略大小写；其余仅 image/* MIME 为图片，空 MIME 的 png 不自动认作图片 |
| 图片对话框 File | 仅 image/* MIME；名为 note.md 但 MIME image/png 仍为图片，不被文本优先规则截走 |
| Windows 路径 | 去首尾空格后只取最后一段；文本三种，图片 png/jpg/jpeg/gif/webp/svg；BMP 不支持 |
| 已返回 DTO kind | 只接受精确 text/image；未知/缺失 kind 返回 unsupported，不根据名字、MIME、content 猜测 |

保留旧 split/pop 语义：名为 md 或 .md 的文件仍按旧入口判作文本；MIME 大小写/空格不额外归一化。无效元数据安全返回 unsupported。浏览器文件选择器的 loadFile 原先不二次限制类型，本项不增加新拒绝条件。分类器不是安全验证器；Rust 的权限/实际字节/类型边界继续执行，未将后端平台层反向依赖前端 Feature。当前 FilesPort 返回正文或 Data URL，原始返回 kind 的纯适配契约由本项测试固定，供 13.3 的协调层使用，不声称现有调用链新增了原始 DTO 消费者。

大小限制和取消缺口保持 R13.1 的责任分配：浏览器 5 MiB、对话框 2 MiB 确认、native 图片 20 MiB 差异不在本项统一；图片异步取消/晚回调归 13.4/13.7，网页 A05/R13-S01 仍待实施。A10 无新增依赖特性、解析/抓取能力。

## 验证与旧测试映射

新增 `tests/stage-13-file-type-classifier.test.mjs` 七组契约：File/MIME 优先级、路径及扩展名、返回 kind、非法输入/不可变性、不读正文和大小、端口销毁与重挂载、生产入口接线。原 `stage-13-import-matrix.test.mjs` 20 项行为保留，注入真实公共分类器代替已迁出的旧分类段；另补一项真实 image-dialog-view 的 MIME-only 冲突路由，继续验证读取/插入行为。

对应关系：原 events 原文执行中的内联分类 → events 原文路由调用真实公共分类器 → 保留支持类型、优先级、阈值、首文件、失败/取消和最近文件断言。没有删除失败场景、跳过测试或复制一份分类实现来测试自己。

本地只运行改动 JS/MJS 的 `node --check`、JSON/差异及模块清单静态核对，不执行 Linux/macOS 产品测试。本项行为、完整前端/架构/浏览器、Rust、原生/WebView 与依赖回归由现有 Windows CI 执行，启动后不轮询；新提交成功前不勾选 13.2，也不推进 13.3。

## 实际链路

```mermaid
flowchart TD
  A["应用组合根"] --> B["有生命周期的兼容端口"]
  C["浏览器拖放与 Windows 路径入口"] --> B
  B --> D["导入公共入口：纯类型分类"]
  E["图片对话框：仅按 MIME"] --> D
  D --> F["text / image / unsupported"]
  C --> G["现有读取与文档插入流程"]
```

Mermaid Chart 已用于复核上述真实依赖关系；未引入第三方库/API，无需新增版本文档查询。

## 首轮 CI 失败与修正（2026-10-01）

`44bbbf294663d3dad6faecda3055f7e03716d035` 的 [Windows CI 36804994799](https://github.com/uniquenesssta/mdr/actions/runs/36804994799) 未通过。递归 Node 1519/1521；仅 `tests/unit/platform/drag-drop-client.test.mjs` 与 `platform-cutover.test.mjs` 两项仍断言 events 中存在 md/markdown/txt 和六种图片扩展名数组。13.2 已将这些规则迁入 Import 分类器，这两项文件位置断言遗漏迁移。根 Node 545/545（包含本项分类器与导入矩阵）、架构 372/372、浏览器 E2E 8/8 已通过；前端、Rust、原生链接、WebView、依赖公告五个 job 成功。收官 job 明确因 repository-tests 失败而阻断，不是第二个独立产品故障。

本次只修改上述两份测试及验收记录。旧断言目的“分类留在应用层，平台只搬运事件”改为：events 调用 scoped 分类接口；实际调用 Import 公共 API 验证原三种文本/六种图片、文本扩展名优先及 browser BMP/native BMP 差异；平台客户端不引入 Import 或分类函数。原文件读取端口、MIME 解码边界、原生事件/订阅/销毁、异常断言和全部测试场景保留，不恢复旧重复数组，不跳过失败，不放宽汇总门禁。

本地仅做两份测试的语法与差异静态检查，不执行 Linux/macOS 产品测试。修正仍须新提交完整 Windows CI；13.2 保持未验收，未开始 13.3。

## 第二轮布局 E2E 超时（2026-10-01）

`d89e55fbb1e4c7f7b78f08e7c03ddc9600c7d0df` / [CI 36807508994](https://github.com/uniquenesssta/mdr/actions/runs/36807508994)：此前两项平台契约修正已通过；递归 Node 1520/1521，唯一失败为 `tests/e2e/preview-layout-stability.test.mjs` 首次可见预览稳定等待超过 3000 ms。其余五个独立 job 成功；汇总因递归失败被阻断。该 E2E 在上一轮相同生产代码下通过，本轮未改布局代码；现有日志没有渲染次数/尺寸/调度状态，不能据此断言产品布局缺陷或确定只是 runner 负载。

本次针对验证边界：两处布局等待使用有界 10000 ms，等待几何发布且 layout 队列无待处理工作；等待完成后仍严格断言 renders === 1、尺寸非零、至少两次 viewport/invalidation/geometry 更新、resize 不重渲染、destroy 后不更新。等待阶段以 renders >= 1 判定可检查状态，重复渲染仍由紧随其后的 === 1 断言报错，不再只能给出含糊超时。未重试测试、未增加 job 总超时或降低这些产品断言。

超时附带渲染/刷新计数、实际尺寸、collapsed、document.visibilityState、layout 待处理状态、浏览器异常和 console；额外检查未捕获浏览器异常为空。无生产代码改动；本地仅语法和差异静态检查，真实行为与本轮失败是否消除仍待 Windows CI，不宣称已确定或修复生产根因。13.2 保持未验收。
