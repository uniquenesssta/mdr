# Markdown Editor

Stage 13：`agent/r13-stage`；R12 已收官；历史见 [docs/README.md](docs/README.md)。

## Change Log

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
