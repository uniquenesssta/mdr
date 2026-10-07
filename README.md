# Markdown Editor

Stage 13：`agent/r13-stage`；R12 已收官；历史见 [docs/README.md](docs/README.md)。

## Change Log

- 2026-10-08：R13.13 前置核查发现上轮收尾 CI 被新增 npm 高危公告阻断；定向更新 source-map-js 1.2.2 与 DOMPurify 3.4.16，本地锁文件审计无高危/严重项。补丁待 Windows 累计回归，导入到文档链尚未实施；保留现有硬门禁和两项 KaTeX/Mermaid low 告警。[详情](docs/R13-13-DETAILS.md)。

- 2026-10-07：R13.12 在 `fabf087` / [Windows CI 36971353716](https://github.com/uniquenesssta/mdr/actions/runs/36971353716) 七组及全部步骤通过，控制器/界面、会话取消与重复插入回归验收并收尾。R13.13 尚未开始，A03/A05 完整剪藏链路仍待联调。[详情](docs/R13-12-DETAILS.md)。

- 2026-10-02：修复13.12首轮CI：同步内联事件数量及Modal/Platform职责迁移断言；Windows浏览器清理遇到taskkill子进程竞争错误时，核实全部报错PID和根进程已退出后才允许通过，残留或不明错误继续失败。新增清理回归，生产代码不变，待Windows重验。[详情](docs/R13-12-DETAILS.md)。

- 2026-10-02：13.11 在 `fb019d4` / [Windows CI 36966040484](https://github.com/uniquenesssta/mdr/actions/runs/36966040484) 七组通过并收尾；开始13.12，剪藏输入/源内容/会话迁入控制器，界面迁入 Import，移除旧全局状态和内联按钮事件，新增生命周期及真实 DOM 回归，待 Windows CI。[详情](docs/R13-12-DETAILS.md)。

- 2026-10-02：13.10 在 `325e5cc` / [Windows CI 36903572172](https://github.com/uniquenesssta/mdr/actions/runs/36903572172) 七组通过并收尾；开始13.11，HTML→Markdown 与元信息组合迁入 Import，修正文字/地址转义、嵌套列表、代码围栏和表格输出，复用公共 URL 策略，新增固定夹具及 Preview/Hybrid HTML sink 回归。待 Windows CI，A05 未关闭。[详情](docs/R13-11-DETAILS.md)。

- 2026-10-02：修复 13.10 首轮 CI 的两项测试接线遗漏：S01 过期“13.9 未完成”断言改查已验收证据，文件/拖放源码浏览器测试补齐 DOMPurify import map。保留公共入口和原行为覆盖；生产代码不变，待 Windows 重验。[详情](docs/R13-10-DETAILS.md)。

- 2026-10-02：13.9 在 `52b28a0` / [Windows CI 36894947377](https://github.com/uniquenesssta/mdr/actions/runs/36894947377) 七组通过并收尾。开始 13.10：HTML 提取迁入 Import，惰性模板解析、正文选择和公共净化边界接通，新增浏览器无执行/无资源请求与端口寿命回归，待 Windows CI；13.11 未开始，A05 全链路未关闭。[详情](docs/R13-10-DETAILS.md)。

- 2026-10-02：R13-S01 后端专项在 `74abbd2` / [Windows CI 36890098604](https://github.com/uniquenesssta/mdr/actions/runs/36890098604) 七组通过并收尾；开始 13.9，将原生/浏览器代理/手动 HTML 协调迁入 Import，接通取消与过期结果拦截，错误和代理提示按纯文本展示。新增回归待 Windows CI；A05 全链路未提前关闭。[S01 验收](docs/R13-S01-DETAILS.md) · [13.9 实施](docs/R13-09-DETAILS.md)。

- 2026-10-02：修复 R13-S01 收尾因旧风险复核指纹过期而失败：复核当前抓取/取消链并更新当前指纹，保留 R12 历史验收快照及全部硬门禁。前轮六组 Windows 测试已通过，本次待精确提交重验，A05 全链路仍未关闭。[详情](docs/R13-S01-DETAILS.md)。

- 2026-10-01：R13-S01 重验 `ff2ed69` / CI 36877688203 的 Rust、前端、原生、WebView、依赖五组通过，根 Node 590/590；唯一直接失败为拖拽 E2E 启动 Chrome 后 CDP 持续拒绝连接，尚未执行拖拽断言。共享测试启动器现仅在未就绪、进程存活且清理成功的连接拒绝情况下恢复一次，以全新进程/端口/目录重启；每次仍限 30 秒，保留诊断，不重跑测试断言，连续失败仍阻断。新增恢复上限与错误保留回归，待 Windows 重验，底层 Chrome 卡住原因尚未确定。[详情](docs/R13-S01-DETAILS.md)。

- 2026-10-01：修正 R13-S01 首轮 CI 遗漏：TLS 用例误指向 src-tauri/tests 下不存在的证书，统一从 Cargo 根定位仓库共享夹具；Windows 旧字节冻结改为保留已批准 S01 用例，仅放行本次路径修正，HTTP/URL 硬门禁同步 17/10 项。四个 job 已通过；Rust 测试编译被该路径阻断，浏览器契约另有 CDP 启动超时（根因未知）。补启动进程/连接诊断与单次探测取消截止，不增加总等待、不跳过断言，待 Windows 重验。[详情](docs/R13-S01-DETAILS.md)。

- 2026-10-01：用户确认 R13-S01 网页策略并开始实施：10 MiB 原始/20 MiB 解压后上限、公网 HTTP(S)、HTML/XHTML、30 秒总截止与 10 次跳转、禁止 HTTPS 降级。后端逐跳解析并绑定连接地址、按实际字节读取和有界解压；新增原生取消配套命令及 AbortSignal 适配，旧 URL 调用与响应 DTO 保留。补真实 Windows HTTP/HTTPS、压缩/大小、私网/跳转与连接取消回归；历史 manifest 保留，新策略单独记录。仅本地静态检查，待七组 Windows CI；13.9 接入等待 R13-S01 验收。[详情](docs/R13-S01-DETAILS.md)。

- 2026-10-01：R13.8 正式收尾：`54fe195` 的 [Windows CI 36864276840](https://github.com/uniquenesssta/mdr/actions/runs/36864276840) 七个 job 全部成功；生产/测试代码保持首轮实现不变，旧启动超时根因仍未确定。开始 13.9 前置策略准备；R13-S01 的网页响应上限与内网支持规则待用户明确确认，后端加固未实施，13.9 尚未接入。[详情](docs/R13-08-DETAILS.md)。

- 2026-10-01：R13.8 首轮未验收：`12352d1` 的 Windows CI 36861368308 中，前端浏览器出现 CDP 未就绪与 app-ready 超时，收尾随之阻断；完整 Node、构建、架构、Rust、原生/WebView 和依赖检查通过。归档日志未包含启动页面诊断，不能确定根因；保持产品/测试实现不变，以本次失败记录触发新 runner 的完整重验，不把超时推定为工厂逻辑错误。[详情](docs/R13-08-DETAILS.md)。

- 2026-10-01：开始 R13.8：图片 Markdown 拼接从 Editor 图片命令迁入 Import 纯工厂，统一 alt/默认值、URL/Data URL 与既有右括号转义；图片命令保留选区归一化和单次替换事务。补纯函数、解析器与命令边界回归，严格保留原输出语义；复杂转义增强涉及冻结 Hybrid 解析器，单独记录未修复。本地静态检查通过，待 Windows CI。[详情](docs/R13-08-DETAILS.md)。

- 2026-10-01：R13.7 正式收尾：`081a16b` 的 [Windows CI 36858258580](https://github.com/uniquenesssta/mdr/actions/runs/36858258580) 七个 job 全部成功，图片读取/取消与累计回归通过，具备 13.8 准入条件。[详情](docs/R13-07-DETAILS.md)。

- 2026-10-01：开始 R13.7：图片 File/Windows 读取迁入可取消 Image Import Controller，URL/上传生成显式插入请求；移除 events/dialog 的 FileReader 实现。拖放代次传递取消信号，对话框换图/关闭/销毁清除旧状态，晚到结果不能复活或插入。补独立生命周期、实际 Platform 与真实浏览器读取回归；本地仅静态检查，待 Windows CI。[详情](docs/R13-07-DETAILS.md)。

- 2026-10-01：R13.6 正式收尾：`073c59b` 的 [Windows CI 36855278836](https://github.com/uniquenesssta/mdr/actions/runs/36855278836) 七个 job 全部成功，图片策略与累计回归通过，具备 13.7 准入条件。[详情](docs/R13-06-DETAILS.md)。

- 2026-10-01：开始 R13.6：浏览器图片 MIME、5 MiB 硬限制及对话框超过 2 MiB 确认集中到纯 Image Policy，分类器/拖放/对话框共用；保留 Windows readImage 20 MiB 与 dropped-file 5 MiB 的 Rust 权威。新增独立边界与端口销毁回归，原入口行为矩阵保留；本地仅静态检查，待 Windows CI。[详情](docs/R13-06-DETAILS.md)。

- 2026-10-01：R13.5 正式收尾：`fd9c35d` 的 [Windows CI 36853092080](https://github.com/uniquenesssta/mdr/actions/runs/36853092080) 七个 job 全部成功，Drop Overlay 与累计回归通过，具备 13.6 准入条件。[详情](docs/R13-05-DETAILS.md)。

- 2026-10-01：开始 R13.5：遮罩 DOM 显示迁入纯 Drop Overlay View，移除 events 渲染逻辑；显示时机仍由 Drop Import 决定，销毁隐藏并释放引用，晚到显示无效。现有 Platform 初始化与真实 DOM 拖放回归接入新 View，待 Windows CI。[详情](docs/R13-05-DETAILS.md)。

- 2026-10-01：R13.4 正式收尾：`cd85861` 的 [Windows CI 36849373596](https://github.com/uniquenesssta/mdr/actions/runs/36849373596) 七个 job 全部成功，完整应用启动恢复，具备 13.5 准入条件。[详情](docs/R13-04-DETAILS.md)。

- 2026-10-01：修正 R13.4 启动阻断：main 误把经典端口的 supports 方法用于原始 Platform，现读取正式 capabilities 字段；补充执行真实 main 组合代码的浏览器/桌面 Platform 回归。两条最近文件旧断言同步加入代次条件，并补过时成功不登记行为测试。首轮根 Node 563/563、独立浏览器 E2E 10/10 通过，但完整应用启动失败；修正待 Windows 重验。[详情](docs/R13-04-DETAILS.md)。

- 2026-10-01：开始 R13.4：迁移浏览器/Windows 拖放计数、遮罩状态与首项分类路由，删除旧分类桥；补充监听解绑、晚到订阅释放及过时文本/图片结果保护。原类型、大小与最近文件行为保留，新增真实 DOM 拖放回归，待 Windows CI。[详情](docs/R13-04-DETAILS.md)。

- 2026-10-01：R13.3 正式收尾：`76735b4` 的 [Windows CI 36821916874](https://github.com/uniquenesssta/mdr/actions/runs/36821916874) 七个 job 全部成功，可开始 13.4。[详情](docs/R13-03-DETAILS.md)。

- 2026-10-01：修正 R13.3 遗漏的 FileSystem 平台测试接线断言：验证 events → Import 与 main → FilesPort，保留平台无文档/Toast 逻辑、命令映射及图片 MIME 边界。首轮唯一失败为该旧断言，根 Node 553/553、架构 372/372、浏览器 E2E 9/9 已通过；本次只改测试与记录，待 Windows 重验。[详情](docs/R13-03-DETAILS.md)。

- 2026-10-01：开始 R13.3：浏览器/Windows 文本读取统一进入 File Import，文档创建继续由 Documents 命令负责；补充取消、销毁、晚到结果隔离及真实 FileReader 浏览器回归。保持原失败提示、最近文件登记和图片规则，本地仅静态检查，待 Windows CI。[详情](docs/R13-03-DETAILS.md)。

- 2026-10-01：R13.2 正式收尾：`8da99a8` 的 [Windows CI 36809102374](https://github.com/uniquenesssta/mdr/actions/runs/36809102374) 七个 job 与同提交证据汇总全部成功，可进入 13.3。旧布局超时具体原因仍不作推定。[详情](docs/R13-02-DETAILS.md)。

- 2026-10-01：R13.2 第二轮分类/平台测试已通过，唯一失败为预览布局 E2E 的 3 秒等待超时（Node 1520/1521）。将该测试两处布局等待改为有界 10 秒并等待调度队列完成，保留严格的一次渲染与双次几何更新断言；超时输出尺寸、状态及浏览器错误，新增无未捕获异常检查。实际超时原因尚不能从旧日志确定，待 Windows 重验。[详情](docs/R13-02-DETAILS.md)。

- 2026-10-01：修正 R13.2 两条遗漏的嵌套平台测试：不再要求类型数组留在旧 events 文件，改为验证 Import 公共分类接口、入口接线和浏览器/Windows 类型差异，保留平台层禁止分类、文件端口和 MIME 边界。首轮 Node 1519/1521，根 Node 545/545；其余五个 CI job 通过。本次未改生产代码，待 Windows 重验。[详情](docs/R13-02-DETAILS.md)。

- 2026-10-01：开始 R13.2：新增无内容读取的 File/路径/返回 kind 分类器，切换浏览器 drop、Windows 路径和图片对话框，删除重复类型判断；保留文本优先/MIME-only 差异、大小警告和失败行为。新增分类/生命周期与入口回归，语法静态复核通过，待 Windows CI。[详情](docs/R13-02-DETAILS.md)。

- 2026-10-01：R13.1 正式收尾：`3c29959` 的 [Windows CI 36801548407](https://github.com/uniquenesssta/mdr/actions/runs/36801548407) 7/7 job、递归 Node 1513/1513、Rust 268/268 全部通过，八个浏览器 E2E 文件正常退出，同提交证据汇总通过。支持矩阵已验收，可进入 13.2；后续已登记问题继续保留。[详情](docs/R13-01-DETAILS.md)。

- 2026-10-01：修正 R13.1 首轮 CI：14 条累计测试仍写死 R12 分支，现与 R13 自动入口一致；浏览器 E2E 完成断言后清理挂起，补 CDP 请求超时/关闭拒绝、Windows 测试浏览器进程树清理和分组结果及时归档。新增导入测试已通过，完整修正待 Windows 重验。[详情](docs/R13-01-DETAILS.md)。

- 2026-10-01：开始 R13.1，按“一大阶段一分支”从 `f6e8cfc` 创建 `agent/r13-stage`。建立 md/markdown/txt、图片 MIME/大小、浏览器/桌面及取消路径支持矩阵与旧实现行为回归；记录桌面图片 20 MiB 与浏览器 5 MiB 差异、2 MiB 确认及待迁移取消缺口。未改生产/模型/依赖；复用七组 Windows CI，待验收。[详情](docs/R13-01-DETAILS.md)。

- 2026-10-01：`e5041b5` 的 [Windows CI 36735955251](https://github.com/uniquenesssta/mdr/actions/runs/36735955251) 7/7 job 及全部步骤通过；递归 Node 1490/1490（300 文件、16 目录）、Rust 268/268、浏览器 11/11+29/29、收官门禁 8/8。收官产物 accepted=true、eligibleForR13=true，R12-24 与 R12 正式收官，具备 R13 准入条件；本次未开始 R13。A04 → R15.4/15.7、A05 → R13-S01 仍未修复，保留截止与止损条件。[收官详情](docs/R12-24-DETAILS.md)。

- 2026-09-30：R12-24 首轮 `ef9b542` Windows CI 失败：递归 Node 1485/1489，四条契约要求保留未完成的 R12-S01；收官脚本误拒绝正常为空的原生编译日志。已拆分安全实现与移交状态，改以原生签名测试成功及上游任务成功判定，新增回归；待 Windows 重验，R12/R13 准入仍未通过。[详情](docs/R12-24-DETAILS.md)。

- 2026-09-30：R12-23 `89e8d57` Windows 6/6、递归 Node 1482/1482、Rust 268/268、浏览器 11/11+29/29、官方公告/TLS/WebView 通过，A10 当前处置验收；开始 R12-24，复用完整 Windows 回归并增加同运行精确证据收官判定，A04/A05 按条件移交但未修复，待 CI。未改生产源码、模型/格式、依赖与命令。[23 验收](docs/R12-23-DETAILS.md) · [24 详情](docs/R12-24-DETAILS.md)。

- 2026-09-30：R12-22 `ccaf7af` Windows CI 5/5、Node 1474/1474、Rust 268/268、浏览器 11/11+29/29 通过，原生安全及两布局合法内容证据已核对，A03 当前渲染风险关闭；开始 R12-23，定向更新 rustls/time/quick-xml/quinn-proto 依赖链，新增官方公告验证与真实 TLS 1.3 回归，待 Windows CI。[22 验收](docs/R12-22-DETAILS.md) · [23 详情](docs/R12-23-DETAILS.md)。

- 2026-09-30：R12-22 整改 CI `36708920012` 为 3/5 job 通过，Node 1474/1474、Rust 268/268、built-app 29/29；四面攻击样例通过，第五面挂载与浏览器模块解析中断。已修正契约测试 DOMPurify 映射及虚拟工厂探针容器所有权，新增浏览器行为回归；待 Windows 重验，A03 保持开放。[详情](docs/R12-22-DETAILS.md)。

- 2026-09-30：R12-22 基线 CI 5/5、全仓 Node 1472/1472、Rust 268/268 通过，R18-N01 已复验；依据真实 WebView 风险接入公共 HTML 净化、CSP 和五面安全/两布局合法内容硬性回归，整改待 Windows CI，A03 保持开放。[详情](docs/R12-22-DETAILS.md)。

- 2026-09-30：R12-22 修正 job env 中不可用的 runner 上下文，日志目录由运行步骤写入 GITHUB_ENV；actionlint 1.7.12 语义检查通过，新增回归；首轮未启动任何测试，修正提交待 Windows CI。[详情](docs/R12-22-DETAILS.md)。
- 2026-09-30：R12-22 启动真实 Windows WebView HTML 基线探测，覆盖 Preview 全量/块与 Hybrid Widget、无害事件及测试自有文件 IPC；已修正 Preview 循环依赖，待 CI；A03 保持开放。[详情](docs/R12-22-DETAILS.md)。
- 2026-09-30：R12-21 修正提交 `cde35b8` 已通过 Windows 专项验收：安全写入 18/18、Rust 268/268、Clippy 通过；累计 Node 1466/1467，唯一既有 Preview 循环依赖归 R12-22。[详情](docs/R12-21-DETAILS.md)。
- 2026-09-30：R12-21 文本/二进制共用同目录临时文件、同步与 Windows 安全替换；新增 18 项故障回归，保留原命令及字节契约；Windows 专项已验收。[详情](docs/R12-21-DETAILS.md)。
- 2026-09-18：R12-08 已验收，09～13 已完成；[详情](docs/R12-08-DETAILS.md)。
- 2026-09-29：R12-14/A01、16 已专项验收；[详情](docs/R12-16-DETAILS.md)。
- 2026-09-30：R12-17 命令迁移，19 项注册不变；Windows 专项通过，40 项遗留不变。[详情](docs/R12-17-DETAILS.md)。
- 2026-09-29：R12-18 修正审计门禁并补齐清单，Windows 审计专项已验收；真实 Preview 循环依赖仍保留失败。[详情](docs/R12-18-DETAILS.md)。
- 2026-09-30：R12-19 修复保存失败传播、dirty 提交边界及 Rust 缓存失效；Windows 专项已验收，Rust 250/250；唯一既有 Preview 循环依赖仍待 R12-22。[详情](docs/R12-19-DETAILS.md)。
- 2026-09-30：R12-20 复核现行脱敏链路，补充错误原因链、异常属性及数组 JSONL 回读断言；Windows 专项已验收；唯一既有 Preview 循环依赖仍归 R12-22。[详情](docs/R12-20-DETAILS.md)。
