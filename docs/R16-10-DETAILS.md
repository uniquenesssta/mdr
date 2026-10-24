# R16-10 测试清理

2026-10-25，用户要求“收尾09开始10”。09实现004b4ab / CI40120746556七组Windows及全部步骤成功，同提交accepted=true、262风险指纹及两份下载归档摘要已核验；正式收尾提交24bd196a751394c382076d54078a2218d039cd99。本任务沿用codex/r16-stage，仅实施16.10，16.11未开始。用户AGENTS.md既有修改保留且不提交。

## 旧断言意图与当前覆盖

tests/support/application-surface-source.mjs原来把五个已退役classic路径重定向到七个现行ESM模块；它实际读取现行源码，并非返回空内容。本次逐处展开真实读取，删除这个临时路径适配器，使用原生文件读取。缺失现行文件会直接失败，历史文件不会作为运行回退。

基线共73个直接或间接消费者、443个静态test调用声明、130处直接旧路径读取；静态声明包含参数化测试，不能等同于运行时用例数。完整路径、基线Git blob、旧测试名称、旧路径与现行所有者映射见[audit/r16-10-test-cleanup.json](audit/r16-10-test-cleanup.json)。额外五处变量/数组/拼接路径读取单列记录，没有只修改字面量后遗漏间接调用。

| 旧断言意图 | 现行读取与保留的实际覆盖 |
| --- | --- |
| core中的文档、菜单、状态与布局职责 | 显式读取Document Workspace、Shell Menus、Workspace Status、Workspace Preferences四份源码并按原顺序组合；原正向、禁止项及调用顺序断言保持。Documents、Persistence、Menu和Layout现有行为套件继续执行。 |
| bootstrap、events、editor-tools、web-clipper职责迁移 | 直接读取Workspace Startup、Application Events、Workspace Preferences、Find Preview Commands；保留启动失败、迟到导入、Find等待保存、切换文档及销毁后的迟到结果等原行为测试。 |
| 全文历史、LayoutState和Preview唯一所有者 | 三处历史/LayoutState/Preview变量读取分别保留六个唯一所有者、原四组有序来源、七个唯一所有者；禁止旧历史栈/第二状态中心/重复Preview实现的每项断言保持。 |
| classic文件语法检查 | 仅删除Atomic 5.13重复语法用例；R16-02现有用例真实import全部七个ESM所有者，同时断言五个旧文件ENOENT及无动态eval，覆盖解析和模块求值。清除未使用的旧源码预读变量。 |
| 手动Preview模式先于自动阈值 | 原源码语句位置断言替换为调用公共resolvePreviewMode：full/virtual/chapter各在微小和超大文档信号下仍保持手动选择；原精确自动阈值、无效设置、不可变和纯函数单测保留。 |
| 导出测试中的真实文档上下文下载 | VM宿主直接读取document-workspace.js中的相同函数体，并在起止标记缺失或反向时明确报错；原导出失败、取消、过期结果及资源释放场景保持。 |

新增四项清理契约：解析器负控与合法历史/冻结正控；基线消费者与Git blob溯源；逐用例声明和原断言保留检查；当前测试无旧读取适配器/直接旧路径读取。使用Vite现有锁定的Rollup解析器，无新增依赖。断言保留检查用于发现遗漏，行为仍由实际运行套件证明；扫描器只识别静态导入和直接读取，不把它当作完整数据流分析，变量调用已另外核对并实测。

只退役上述一项冗余语法场景，新增四项清理契约，运行时用例净增三项（2791→2794）。保留有效架构约束、缺席检查、故意构造的旧实现负控、git show历史验收、冻结模型路径与哈希，以及全部真实浏览器和Windows原生链路。生产源码、UI、模型、Rust、依赖及构建配置均未修改。

## 验证与状态

首轮50项相关测试48通过、2失败：新增解析器负控误用错误消息文本，以及新移除文件尚在Git索引枚举中。修正明确语法错误消息并登记单文件移除后49/50；全局扫描进一步发现通过style-test-utils间接调用的三处旧路径，已纳入账本并直接迁移，未跳过检查。随后清理契约及CSS相关10/10通过。首轮全仓2794项中2789通过、5项失败：一处同步read误用Promise组合、三类动态/resolve路径遗漏（包含两条Platform场景）。明确保留同步读取，并展开Web Fetch、Locale和Platform所有者组；扩充resolve/join解析负控与五处间接读取记录，全部原断言保持。修复相关37/37通过，最终完整复验2794/2794通过（370文件、16目录，失败/取消/跳过均0）；首次失败日志保留，不据其验收。最终四门禁全部通过；记录补齐后，收尾指纹、删除清单和清理契约26/26再次通过。

浏览器契约11/11、实际应用75/75通过，console error和未处理异常均0。现有构建来源及全部输出逐字节核对通过：来源指纹7b27e96f2b414c4fb09979bf6942470cf7aabd3a1eaceaa4024bbd7b60bc4a78、473输入/136输出，与09一致；全仓内09实际无缓存DEV/生产用例继续通过。10未修改产品，不把09原生CI当作10精确提交验收。审计1103输入、264风险指纹、10份受保护源码哈希及R12/R15/09既有验收一致。

日志保留于系统Temp：mdr-r1610-focused.log（48/50）、focused-final.log（49/50）、guards-final.log（10/10）、repository.log（2789/2794）、repair.log（37/37）、repository-final.log及repository-final/repository-audit（2794/2794）、browser-contract.log（11/11）、browser-app.log（75/75）、final-gate-*.log（四门禁）。上述后缀均以mdr-r1610-开头。

09正式验收保持，10尚待精确实现提交Windows CI，不提前勾选任务书。推送后停止CI轮询，由用户提供结果或要求查看。11未开始。

## 恢复

可从24bd196逐文件恢复本次测试和治理记录；旧读取适配器的精确Git blob保存在审计账本。没有文档或持久化数据迁移，也不清理用户原文、日志或本机生成目录。

## 正式验收（2026-10-25）

实现72fd215ee67e41bcbd2d7ed10d99a52b59a5a6c0的[CI40125945813](https://github.com/uniquenesssta/mdr/actions/runs/40125945813)七组Windows及全部步骤通过；同提交accepted=true、264风险指纹一致，实际Node日志累计2794/2794（370文件、16目录）。10专项4、Rust301、浏览器11＋75与真实WebView安全/导入、大文档4路及原生导出读回均通过，10正式收尾。初始失败和修复记录保留。

closeout归档12573702054（11830字节）SHA256=2bf22f747f6d03f67b329867cc3d9aad092b9ff937661869268a2cd6db331a5f；WebView归档12573297086（1393065字节）SHA256=e04657426a1a98f7d76538e634a84373afe6d6039ba15b4e976252fad7dec095，均已下载核对。

用户授权11命名检查，沿用codex/r16-stage；搜索迁移后缀、日期副本和重复模块，合法历史/领域命名须有可核对说明，12未开始。用户AGENTS.md既有修改保持，推送后停止CI轮询。
