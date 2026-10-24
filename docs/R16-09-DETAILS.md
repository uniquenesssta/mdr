# R16-09 生成文件清理

2026-10-25，用户要求“通过ci 开始09”。08修复a2899c5 / CI40114949538七组Windows及全部步骤成功，同提交accepted=true与closeout/WebView下载摘要已核验；收尾基线a2fc2669a1dffbcdf4b89a571d276ba5b182667f。继续唯一codex/r16-stage，仅实施16.9，不进入16.10。用户AGENTS.md既有修改保持且不提交。

## 清退范围与数据边界

逐文件移除旧根目录.vite/deps/_metadata.json（146字节）及package.json（23字节），共169字节；未递归删除目录。原路径、Git blob、SHA256和基线记录在architecture-baseline.json的auditCorrections.r16GeneratedRetirement。删除清单保留这两个候选的缺席证据，避免删除后丢失审计范围。

这两份JSON只有旧优化摘要及模块类型，不是模型、文档或测试输入。生产import/HTML无消费者，当前vite.config.js明确使用父目录node_modules/.vite/markdown-editor；生产构建输入只包含index、依赖配置、src/public和scripts/build。新实测完全独立缓存与全新输出目录中的DEV和生产构建均可打开真实文档，不需要根.vite内容。

当前Git没有跟踪logs、dist/target、依赖目录、artifacts或隔离测试程序。临时验证输出位于系统临时目录，日常dist、父目录构建缓存、开发日志和用户原文保留。固化的journal/恢复/导入测试输入及Tauri管理的四份gen/schemas不是临时运行输出，继续跟踪；不把16.10有效测试清理提前实施。

## 不可豁免门禁与忽略规则

现有checkGeneratedFiles继续唯一拥有治理逻辑，无新增清理器、持久状态或删除API。缓存、依赖、dist/target、开发日志、artifacts、隔离程序及其压缩包等已确认生成路径一经Git跟踪即失败；活动trackedGeneratedFiles必须为空，不能通过精确豁免或重新生成基线放行。保留旧日志专用错误码、缺席豁免检查及非法迁移后缀检查。

使用Git真实check-ignore一次核对根.gitignore对整个输出目录和临时程序压缩包的保护；目录否定、扩展名忽略、仅忽略子文件、本机exclude/global忽略都不能替代共享目录规则。新增target、artifacts、cargo目标与隔离程序目录/压缩包规则，既有日志及依赖规则保持。

旧断言迁移：Stage01当前两项缓存豁免变为零，加上09清退2项及15.13日志清退2项继续等于历史4项；历史记录未重写。15.13“非日志精确豁免可保留”改为“09后同样不可豁免”，仍强制加入缓存并重新生成基线，同时保留新dist拒绝场景；原17项场景数量与合法journal正控保持。

## 验证与状态

先在旧门禁跑新增22项真实Git契约，1通过、21失败，证明基线豁免和共享忽略缺口；首轮清理后58项相关检查仅审计快照漂移失败，明确刷新快照后再验。新实际页面首轮验证脚本字符串未转义而失败，修正仅使用JSON.stringify编码固定夹具，未改产品；随后全新缓存DEV、全新生产构建、默认无E2E全局、真实导入/模型正文及身份均通过。

生产源码、UI、冻结模型、Rust、依赖、实际Vite配置及原生行为保持。09已实现；68项相关契约（含23项新增契约/真实DEV与生产场景）及四项硬门禁通过。全新构建来源指纹7b27e96f2b414c4fb09979bf6942470cf7aabd3a1eaceaa4024bbd7b60bc4a78，473输入/136输出，与08产品来源一致；不以旧dist替代本次无缓存构建。262项风险指纹、1102审计输入、10份冻结源码及R12/08正式验收已核对。首轮全仓2788项中2787通过、1项原有Link Preview实际页面因导航到chrome-error错误页而失败，没有记为通过。本机TCP动态端口范围是1024–15000；在自有10080端口HTTP夹具复现了原始CDP返回net::ERR_UNSAFE_PORT，[Chromium官方端口政策](https://raw.githubusercontent.com/chromium/chromium/main/net/base/port_util.cc)也列明该端口受限。首轮未保存原始端口/导航错误码，不能断言那一次的确切原因；独立诊断复验在5764端口通过。

确认共享built-application-host直接listen(0)存在相同错误页的可达缺口，且09新清洁构建也消费它。它现在复用CDP既有端口政策，释放受限监听后最多32次分配，保留实际接受的监听以避免端口预留间隙；补齐有界失败、每个监听关闭及幂等销毁测试。CDP导航直接报告Page.navigate错误码和URL，不再等后续模块加载才显示不相关的错误；不重试产品断言、不放宽原时限或恢复次数。测试主机HTTP/路径/Worker原场景与Link Preview的25次连续焦点/销毁断言保持。原始失败和诊断日志保留；修复相关20/20、浏览器契约11/11、实际页面75/75及四门禁复验通过，原测试场景全部保留，完整全仓复验2791/2791（369文件、16目录）通过；必须由09精确提交Windows CI通过后验收。08验收保持，16.10未开始，推送后停止CI轮询。

## 最终构建证据补正

最后比较独立输出时发现，新用例同一进程中先启动DEV会让NODE_ENV继续是development，早期独立build虽然运行成功但不能作为生产构建证明。已在该用例内隔离环境并断言Vite实际isProduction=true、mode=production，退出恢复环境；未改变产品配置。修正后单项1/1实际DEV及生产导入通过，136个生产输出与已通过75项浏览器回归的08产物逐字节相同，来源473项一致。全仓2791/2791结果保留，最终用例1/1及审计/清退证据44/44按修正后的源码再次通过；不把早期DEV输出记作生产证据。

最终日志：Temp/mdr-r1609-before.log（旧实现1/22）、mdr-r1609-contracts.log（快照漂移）、mdr-r1609-final-contracts.log（68/68）、mdr-r1609-repository.log（首次2787/2788）、mdr-r1609-link-navigation-diagnostic-fixed.log、mdr-r1609-http-repair.log（20/20）、mdr-r1609-browser-contract.log（11/11）、mdr-r1609-browser-app.log（75/75）、mdr-r1609-repository-final.log及repository-final/repository-audit（2791/2791）、mdr-r1609-production-clean-final.log（最终1/1）。浏览器console error及未处理异常均0；四门禁通过。新CI验收仍待执行，09未勾选，10未开始。

## 恢复

需要恢复时可从a2fc266的两个明确Git对象还原缓存，并对应回退09政策变更；不涉及文档或持久化数据迁移。不会自动删除本机生成目录或用户文件。

## 正式验收（2026-10-25）

实现004b4aba232b3c643524978522fe35dd66c242f0的[CI40120746556](https://github.com/uniquenesssta/mdr/actions/runs/40120746556)七组Windows及全部步骤通过。精确提交closeout accepted=true、run/commit及262风险指纹一致；全仓2791（369文件、16目录）、09专项23、Rust301、浏览器11＋75、四门禁、真实WebView安全/导入、大文档4路与原生导出文件读回均通过。09正式收尾，首轮导航及构建验证修正记录保留。

closeout归档12570953095（11762字节）SHA256=eb2d66c6ad3371ba0cea17e4a6eaced80b7644d3696e74a928d07c50f961f03b；WebView归档12571092895（1394993字节）SHA256=c5d30770dac1ca3075d2746b1d719d422b5f0f60a56d0126e7006fb416e7285f，均已下载核对。

用户授权10测试清理，沿用codex/r16-stage；保留有效行为、真实链路、模型冻结与历史验收证据，不以删场景或跳过测试实现通过。16.11未开始，用户AGENTS.md既有修改保持，推送后停止CI轮询。
