# R12-24 R13 前完整 Windows 复验与审计交接

状态：已开始，R12-23 精确提交 `89e8d57` 的 [Windows CI 36718273620](https://github.com/uniquenesssta/mdr/actions/runs/36718273620) 6/6 通过。12.24 当前准备与风险/接收核对完成，新一轮精确提交 Windows 结果待验收；R12 整体与 R13 准入尚未勾选。唯一分支 `agent/r12-stage`，回退点 `89e8d57bb58ac19facf035c574592e1b73cc9ee2`。

## 当前问题处置与范围

| 项 | 修复提交 / 记录 | 当前结论与本轮复验 |
|---|---|---|
| A01 | `3cf4b68` / R12-14，R12-20 `ed52b10` 补验 | 嵌套结构与错误链脱敏已修；真实 frontend payload→Rust→JSONL、release 无日志继续执行 |
| A02 | `601e314` / R12-18 | 门禁、递归清单与历史断言已整改；原 40 失败已由当前 1482/1482 消除，R18-N01 在 R12-22 已关闭 |
| A03 | `ccaf7af` / R12-22 | 当前本地 Markdown Preview/Hybrid sink 与 CSP 已验收；五面真实 WebView 与两布局正常内容继续执行 |
| A06 | `cde35b8` / R12-21 | 共用安全写入、恢复副本与 Windows DACL/拒绝边界已修；18 项故障继续执行 |
| A07/A08/A09 | `d269fad` / R12-19 | 失败提交/缓存、大小写身份和已保存状态已修；真实 Windows 磁盘拒绝、别名与敏感目录、保存/切换/关闭故障继续执行 |
| A10 | `89e8d57` / R12-23 | 当前公告已处置；官方原始扫描、实际目标图/特性/MSRV、TLS 1.3 与证书拒绝继续执行 |
| A04 | R15.4 / R15.7 接收 | **未修复**。debug 部分写入的重放与 50ms 重试仍有风险，见下面止损条件 |
| A05 | R13-S01 接收 | **未修复**。响应大小/MIME/内网/重定向规则仍待明确策略与后端实施，先于 13.9 联调 |

精确修复 SHA、记录路径、接收 Atomic、截止条件与复核源 Blob 见 [机器记录](audit/r12-24-closeout.json)。原审计发现和历史失败日志保留；当前裁定不能再把已解决的 40 失败/R18-N01 称作活动失败。

## A04 / A05 转交核对

A04 已复核 `src/runtime/performance.js` flush 的整批 requeue 与 50ms 调度、Rust writer 的逐条 append 和 release 提前返回。现有 Windows release writer/lifecycle 无日志门禁通过，日志计量在业务 future/function 完成后记录，仍不能证明 debug 下无资源争用或无界增长。本轮没有实际 debug 持续磁盘故障压力证据，不把“尚未测到”写成“安全”。按既定任务书转交 15.4/15.7：同一确认协议、部分成功尾部处理、有上限的队列/次数/时间和退避，真实 Windows 写盘回读，失败不阻塞主应用保存/关闭；若当前确认主应用不可用或不可控磁盘增长，先止损再转交。

A05 已复核当前本地桌面用户 URL 入口→显式平台 web fetch→normalize_url→reqwest→response.text：只有 30 秒 timeout 和 10 次跳转上限，没有大小、MIME 或逐跳地址策略。本轮不新增自动网络来源、抓取权限或新导入能力；当前渲染净化/CSP 及 TLS 边界已回归，不能因此声称抓取安全已解决。R13-S01 仍需明确具体限额/内网支持策略，在 13.9 之前实施后端流式限制、每跳地址/最终目标/MIME 与资源取消，并跑真实受控 HTTP/压缩/跳转/IPv6 测试及网页→两渲染路径链路。若现有入口确认高风险绕过，先限定危险路径，不因排期扩大暴露。

## 完整 Windows 验证与收官判定

复用现有六个 Windows job，不重复建设产品测试系统：前端接口/冻结模型、根 Node、递归全仓 Node、架构/真实清单/历史运行时/文档/生成门禁、生产构建、浏览器、Rust 全量/格式/Clippy/check、真实文件/日志/HTTP/TLS故障、release 无日志、原生链接、实际 Windows WebView、官方 RustSec。原生链接只证明编译链接，不冒充实际系统浏览器启动。

新增 `audit-closeout` 等待六项结果，任何失败/取消/跳过均拒绝准入；使用 download-artifact v4 从当前运行下载精确 SHA/attempt 的各自目录，禁止合并同名文件。聚合脚本检查 commit.txt、动态递归清单与所有目录退出码、Rust 全量结果、浏览器结果、CSP/真实 canary/五面/两布局证据，解析原始 cargo-audit 和 Windows metadata 后复用既有判定，再核对锁文件 digest。检查 R12-01～23 已验收、A04/A05 后续正文与九个风险复核源码 Blob 未变；复核源变化必须重新评审。七项拒绝场景测试覆盖失败/缺失任务、旧 SHA、漏测、伪成功 WebView、错误移交及不完整 Rust 证据。

输出 `r12-24-closeout-<SHA>-<attempt>/closeout-verification.json`。失败仍归档 accepted=false；成功才写 accepted=true/eligibleForR13=true，保留 A04/A05 未修复记录。此输出是 CI 证据，正式仓库收官仍需按该运行归档、勾选 12.24 后才进入 R13，本轮不提前开始 R13。

本地执行环境连接失败，使用 GitHub 精确 Blob/树编辑；仅完成内存中的 JS 语法、JSON、相对导入、文件范围、工作流原六 job 保留和差异静态复核，不能替代 Windows。未改生产源码、冻结模型、依赖/锁文件、命令 DTO 或持久化格式。无源码删除与新生产依赖。Context7 核对下载 artifact 目录/运行范围，再读取实际 v4 action.yml，未照搬当前 v8 独有选项；Mermaid Chart 展示真实验证汇聚。

## 交付边界与后续

A03 的证据是当前 sink/虚拟块工厂，不是完整虚拟滚动性能或新增网页来源；A10 对本次官方数据库快照成立。安装/升级/文件关联、真实系统外链、OS 关闭/断电恢复与大文档性能属于 R17 完整矩阵，不宣称已在本轮完成。R13 重新核对新增解析/抓取能力，R17.8/17.9/17.17 再扫当日公告和完整交付矩阵。

推送启动 Actions 后结束，不轮询。约 15～20 分钟后发“查询 R12-24 CI”。
