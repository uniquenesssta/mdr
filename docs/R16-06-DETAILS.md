# R16-06 巨型文件清除

## 范围与基线

用户要求“收尾05开始06”。05在d072309ff623cd0118498da679b2aafbf3b21a66 / CI40066385721精确验收；从收尾ac3fc3e82b8e4d1258ed38ab991be10686d06317继续唯一codex/r16-stage，仅执行16.6。用户AGENTS.md既有修改保留，不纳入提交。16.7 Runtime、16.8兼容清理及后续未开始。冻结模型、UI外观、Rust/IPC、磁盘格式、依赖与锁文件不变。回退使用本项提交的git revert，不重置用户文件。

## 逐文件映射与职责

| 已移除路径 | 当前唯一实现 | 对外入口 |
| --- | --- | --- |
| src/editor/hybrid-markdown.js | src/features/editor/infrastructure/codemirror-hybrid-extension.js | features/editor/index.js |
| src/editor/virtual-editor.js | src/features/editor/infrastructure/virtual-editor.js | features/editor/index.js |
| src/storage/native-document-store.js | src/features/persistence/native-document-store/native-document-store.js | features/persistence/index.js |
| features/hybrid-editor/compatibility/codemirror-source-editor-port.js | features/editor/infrastructure/codemirror-source-editor-port.js | Editor内部适配器 |

剩余三份原聚合文件的业务职责已在阶段5/8/10分离，本次将不可丢失的集成、host/版本日志和原生队列编排归入对应功能目录，旧路径不保留wrapper。CodeMirror Source Port随集成归Editor，避免新增跨功能内部导入，并保持Hybrid公共入口可由浏览器直接加载、不引入CodeMirror包。此Port仍是实际能力适配器，未删除兼容业务链；其余兼容退出属于16.8。

main通过Editor/Persistence公共入口，功能内直接依赖同功能实现；数学/Mermaid改用已有Preview公共入口，Hybrid控制器仍由Hybrid公共入口消费。单个文件迁移逐次执行，没有批量删除目录、用户数据或忽略文件。新文件不复制状态；原始实现函数体完整保留，新增职责头及导入调整；Host销毁、Widget控制器、队列/上传/分段读和失败恢复仍由同一对象拥有。

## 验证与证据

迁移前原路径69/69（Native Session/Queue/Upload/Load/Search、Hybrid集成与Editor适配器/扩展）通过，日志Temp/mdr-r1606-before-tests.log。现有32个测试文件仅更换当前源码位置和公共导入，旧断言意图保持：同一模型/能力边界、数据/错误/取消/过时/销毁、队列与实际接口，未跳过用例或缩小场景。新目录API门禁对四份实现完整函数体与收尾基线逐字比较，检查旧路径缺席和生产导入，无旧路径/内部绕过且负向注入必须拒绝。R15冻结事件目录保留旧路径与43源SHA，当前生产者映射到新Editor位置，原事件字段/调用不变。

迁移后相关271/271通过；新增目录API门禁7/7，CI独立组合76/76通过。首轮相关263/271：8项仍绑定旧相对导入/内部入口的文本断言，按相同公共能力更新位置后全过，场景和断言未删除。删除清单与closeout首轮28/29的唯一失败是生成新清单后风险SHA尚未刷新，按最终清单更新实际SHA，不修改校验器。全部首轮日志保留。生产构建通过，main 586.23KB，包体预算500000/700000字节不变；511构建输入与137产物，来源SHA256=d3a86f54402d99bdbe25528dc7a9458ab4e7cad8c67b466ee43ff07cc495802b。生产模块仍570项；233风险源和10冻结源最终复核一致。浏览器契约11/11、生产实际页面75/75通过，控制台错误/未处理异常均0；全仓2750/2750通过。

审计清单保留104候选（41已缺席/55有引用/6受保护/2证据不足），所有deletionAllowed=false；旧Source Port固定记录为已缺席，不因改路径从候选消失。该保守清单不是删除授权；四个已迁移文件的逐项证明在本记录、完整函数体测试、当前所有权清单与实际构建链提供。其余已缺席原文件不重复删除；8个冻结JS模型、kernel入口和Rust模型保持。

当前尚待精确实现提交Windows累计CI，不勾选16.6。

## 最终交付验证

全仓2750/2750，363文件/16目录，每组退出码0，失败/跳过/取消0；专项76/76、全部直接相关271/271、实际浏览器11＋75及四项门禁均通过，生产构建与来源指纹一致。233风险源精确git blob SHA、1133输入审计快照、10冻结源和570项真实生产集合已核验，原43源事件目录与R12不可变政策、R16-05正式验收保持。

证据：Temp/mdr-r1606-before-tests.log、mdr-r1606-affected-tests.log（263/8首轮）、mdr-r1606-affected-tests-final.log、mdr-r1606-directory-tests.log（28/1摘要刷新时序）、mdr-r1606-ci-contracts.log（76/76）、mdr-r1606-build.log、mdr-r1606-browser-contract.log与-browser-app.log、mdr-r1606-browser-app/built-app-diagnostics.json、mdr-r1606-repository-tests.log及mdr-r1606-repository/repository-audit/test-inventory.json与suite-results.json。浏览器使用bundled Node24.19.0/Undici7.29.0。

三个明确停用的R10 Linux workflow及历史阶段3取证脚本仍含旧原生路径记录，不属于当前生产导入或当前Windows执行步骤；不恢复已停用工作流，不重写历史归档，后续旧测试/职责清理由16.10/16.12处理。当前生产/现行行为测试的全部调用已切换，旧路径在删除清单与本项负向门禁中作为已退出证据保留。

本项未改变Rust、IPC、数据格式或生产依赖，未重跑完整本地Rust/原生WebView；05的301项Rust和四路大文档CI仅作为基线，06须由新精确提交Windows累计CI复验后验收。代码已实现与本地检查通过分别记录；06尚未验收，16.7未开始。推送后停止CI轮询，待用户报告或明确要求查看结果。
