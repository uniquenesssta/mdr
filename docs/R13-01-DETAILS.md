# R13.1 导入支持矩阵与行为基线

状态：**已验收**。修正提交 `3c299591b11dda238b212be68c9b6beb5b8a7726` 的 [Windows CI 36801548407](https://github.com/uniquenesssta/mdr/actions/runs/36801548407) 七个任务全部成功。阶段唯一分支 `agent/r13-stage`，来自 R12 收尾提交 `f6e8cfcdd618e138ec79cf6ed0296a679a2931a7`；其 Windows CI [36753976296](https://github.com/uniquenesssta/mdr/actions/runs/36753976296) 已成功，R12 收官原始产物及验收见 [R12-24](R12-24-DETAILS.md)。该提交也是本阶段回退基准。

## 范围与职责

13.1 的交付是现有支持矩阵、可执行测试表及迁移边界，不提前实施 13.2 分类器、13.3 文件协调器或 13.6 图片策略。通用迁移模板中的“创建目录、切换调用者、删除旧实现”在实际迁移对应职责时执行；本项不创建无消费者的生产入口或第二份策略。没有生产代码、模型、存储格式、依赖、DTO 或命令变化，也没有源码删除。

已逐入口核对 `public/app/core.js`、`events.js`、`export.js`、`web-clipper.js`、`src/features/editor/ui/image-dialog-view.js`、平台文件/对话框端口和 Rust local_file。任务书列出的 `src/runtime/tauri.js` 已不存在，实际平台实现为 `src/platform/`；图片对话框已属于 editor UI，不能照旧模板只迁移 editor-tools。文档创建继续由 Documents Controller 唯一负责。

## 支持与测试表

大小按字节计算：1 MiB = 1024 × 1024；旧提示仍使用 MB，不改变文案。

| 入口 | 当前支持、优先级和边界 | 失败/取消行为 | 验证与后续责任 |
|---|---|---|---|
| 浏览器文件选择 | UI 提供 md/markdown/txt；FileReader 读文本；loadFile 本身不再校验扩展名，无本层 20 MiB 限制 | 空选择无导入，input 清空以便重选；error/abort 进入导入失败提示 | 新测试 picker/text read；13.2/13.3 |
| 浏览器拖入文本 | 首个文件；扩展名忽略大小写，md/markdown/txt 优先于 MIME | 空列表无动作，非支持类型提示 | 新测试 text precedence/multiple drop；13.2～13.4 |
| 浏览器拖入图片 | 非文本扩展名后按 image/*；包含浏览器报告的 BMP；恰好 5 MiB 可插入，超过拒绝 | 超限/不支持提示；此旧路径只有 onload，读取失败/取消清理不足，不能称已解决 | 新测试 MIME/boundary；错误与取消补全由 13.4/13.7 |
| Windows 文件选择 | dialogs.openFile 返回单路径或 null；过滤 md/markdown/txt；走 native drop 路由 | null 不读文件/不创建文档；对话框错误提示 | 新测试 picker；现有平台 dialog 测试；13.3 |
| Windows 文本路径/拖放 | md/markdown/txt；files.readText → readDroppedFile → Rust UTF-8 读取，20 MiB 上限 | 错误不加入最近文件；文档加载成功才登记 recent | 新测试 native paths/failure；既有 Rust text_reader/commands 的真实 I/O；13.3 |
| Windows 图片路径/拖放 | png/jpg/jpeg/gif/webp/svg，按扩展名；当前 files.readImage → readLocalImage，实际为嵌入图 20 MiB 路径 | 错误提示，不插入；BMP 不支持 | 新测试 native image routing；既有 Rust image_reader/path_policy；13.6/13.7 须明确该差异 |
| Rust read_dropped_file 图片分支 | 同上扩展名，MIME 为 image/png、image/jpeg、image/gif、image/webp、image/svg+xml，5 MiB 上限 | 超限拒绝 | 现有 file_kind/image_reader 真实 I/O；该分支不是当前前端 native 图片拖放调用路径，不能混写 |
| 图片对话框上传（两环境） | image/*；大于 2 MiB 先确认，大于 5 MiB 直接拒绝，等于边界允许；选择后保存 Data URL | 确认拒绝/空选择不插入；destroy 解绑监听；异步晚回调仍需后续补强 | 新测试 image dialog 大小/拒绝/URL/upload/destroy；13.6/13.7 |
| 图片 URL | trim URL/alt，经现有插入命令；不由本层下载和计量 | 空 URL 不插入，保留选择范围 | 新测试 image URL；13.7/13.8 |
| Windows 网页 | desktop.webFetch 优先；Rust 30 秒 timeout、10 次跳转；失败展示手动 HTML，绝不自动转公网代理 | 无正文/错误不插入；取消资源与过时代次尚待迁移补全 | 新测试 native web success/failure；既有真实 HTTP/TLS；R13-S01、13.9/13.12 |
| 浏览器网页与手动 HTML | 本地代理或既有公共代理序列；失败显示手动区域；转换优先 fetchedHtml，再用手动 HTML | 空内容/转换失败提示；关闭时清空已缓存 HTML，但进行中抓取尚无可靠取消/代次 | 本项静态核对，完整行为/受控网络/UI 链路由 13.9～13.13 验证，不声称已通过 |

`tests/stage-13-import-matrix.test.mjs` 执行旧实现原文片段及真实 image-dialog-view，注入受控 DOM/文件读取/平台端口观察路由与副作用；不复制分类实现，不用该测试冒充真实 Windows 文件选择、系统拖放或真实网络。真实 Rust 文件 I/O、HTTP/TLS、WebView 和浏览器门禁继续使用现有 Windows 工作流。

## 审计承接与未完成策略

A10：本项无生产调用、解析器、抓取能力、Cargo feature 或依赖变更，`package.json`/两个锁文件/Cargo.toml 与 R12 已验收基线字节一致；不会新增原先不可达的依赖路径。现有官方 RustSec/Windows 依赖图与 TLS 门禁继续运行，新增调用在对应迁移项再次评估。本项结论不替代后续输入可达性和最终公告扫描。

A05 / R13-S01 仍未修复。响应原始/解压后上限、MIME 缺失与伪造处理、环回/私网/IPv6、每跳与最终目标策略尚待产品决策；本项只记录现状，不将本地图片 5 MiB 自动套到网页响应。必须在 R13-S01 实施前形成可审阅策略并确认，先于 13.9 完成后端限制。A03 继续复用现有净化/CSP，新增网页输入全链路归 13.10～13.13。

已识别待迁移缺口：native 图片拖放 20 MiB 与浏览器 5 MiB 不一致；旧浏览器图片 drop 缺 error/abort；图片对话框晚到读取回调没有销毁/代次保护；网页关闭没有中止在途请求。上述是后续 13.4/13.6/13.7/13.9/13.12 的明确行为决策与修复责任，不把缺陷冻结成正确行为，也不在 13.1 偷改阈值或声称已修复。

## 分支、CI 与验证

每个大阶段从上一阶段验收提交创建一个分支，同阶段全部子任务在该分支推进，不为每个 Atomic 再开分支。R13 唯一分支为 `agent/r13-stage`，R12 分支保留验收历史。

复用 `.github/workflows/r12-14.yml`，在本阶段快照中将自动分支切为 R13 并更新显示名；七个 Windows job、失败退出、原有测试和证据保留，不复制一套流水线。原分支路由断言改为验证当前 R13 分支，保留 workflow 修改触发与禁用非 Windows 的原覆盖目的。新增测试由现有根 Node 和递归全仓入口自动发现。

本地只检查 JS/YAML 语法、文档/差异与保护文件字节，没有执行 Linux 产品测试。最终以本轮精确提交的 Windows CI 为准，未通过前不验收；Actions 启动后结束、不轮询，约 15～20 分钟后查询 R13.1 CI。


## 首轮失败与修正（2026-10-01）

提交 `d8476fd0efdafd2a03fdae01df9eb09e85d6c3e5` 的 [Windows CI 36757863020](https://github.com/uniquenesssta/mdr/actions/runs/36757863020) 失败，13.1 不验收。根 Node 534 项中 520 通过、14 失败，全部失败均为旧累计契约仍断言 `agent/r12-stage`；新增 20 项导入行为测试通过。先前只更新总路由测试，遗漏 14 个独立阶段文件。本次仅将这些断言的分支名改为 R13，自动入口、路径、命令、累计覆盖和失败退出断言均保留，不修改历史 workflow。

递归 Node 的前两组已完成；E2E 第八个文件 window-controller 已打印业务断言成功，但未返回文件级 TAP 结果，最终触及 40 分钟 job 超时。日志不能精确区分 Fetch.disable 与进程/句柄清理中的哪个等待，源码确认二者均存在无界或错误退出判定：CDP send 不设截止，process.killed 只代表发送过信号。本次公共 CDP helper 为命令设置 30 秒截止，关闭时拒绝待定请求、清理计时器；Windows 仅终止该测试启动的浏览器 PID 及其子进程，以实际 exitCode/signalCode 确认退出，并关闭管道。补三项无响应/主动关闭/发送异常回归，真实浏览器清理由原八项 E2E 继续验证。

递归运行器每完成一组即保存 suite-results，避免后续挂起抹去前组证据；缺目录、失败、取消仍阻止汇总通过。上一轮收官缺 suite-results.json 是递归任务超时的后果，不将缺失文件伪造为成功。本次不提高总超时、不跳过测试、不修改生产源码或 R13 后续范围。

修正提交待 Windows CI。本地只做语法、改动范围与断言静态复核，不执行 Linux 产品测试；保留失败运行与已知待迁移问题。

## 正式验收（2026-10-01）

精确提交 `3c299591b11dda238b212be68c9b6beb5b8a7726`：Windows 七个 job 全部 success；递归 Node 1513/1513（302 文件、16 目录），根 Node 537/537，Rust 268/268。浏览器 E2E 八个文件完成，无清理挂起；官方公告、原生链接、真实 WebView、累计前端/架构与同提交证据汇总均通过。汇总日志明确 same-commit Windows revalidation passed，工件 `r12-24-closeout-3c299591b11dda238b212be68c9b6beb5b8a7726-1`（ID 11135737544）已归档。

13.1 的支持矩阵与行为基线正式验收，准入 13.2。此前失败日志保留作为历史；后续图片大小差异、读取取消/晚回调和 A05/R13-S01 仍按既定子任务处理，不因本项通过而关闭。关闭本项不修改生产代码或依赖。
