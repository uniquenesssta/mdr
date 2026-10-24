# R16-11 命名检查

2026-10-25，用户要求“收尾10开始11”。10实现72fd215 / CI40125945813七组Windows及全部步骤通过，同提交accepted=true、264风险指纹与两份下载归档摘要核验，正式收尾提交aac985b3181df63507c88bbc4e591a4b91f4d4d2。本任务沿用codex/r16-stage，仅实施16.11，16.12未开始；用户AGENTS.md既有修改保持且不提交。

## 检查范围与结论

现有单一后缀检查只检查最后扩展名前的末尾词，遗漏目录、camelCase、多重扩展名、日期和Windows副本编号。由scripts/architecture/module-naming.mjs统一检查Git跟踪路径及实际发现的生产文件；原Generated Files与Architecture门禁接入同一检查，不保留第二套命名正则。原生成物、共享忽略和不可豁免逻辑保持。

搜索old/new/v数字/final/copy、分隔或紧凑日期及“(2)”副本形式；词边界区分folder/newline/finalize/copyright等正常领域词。检查大小写路径冲突、生产/构建/共享测试宿主中的完整内容副本，以及同名生产模块的职责。固定攻击输入、JSON数据夹具和忽略的本地输出不视为执行模块。空export模块没有业务实现；相同文本本身不能证明它们拥有重复业务状态。完整内容比较及同名审查不宣称能证明任意语义等价，不借此扩展16.12依赖图任务。

完整结果见[audit/r16-11-module-naming.json](audit/r16-11-module-naming.json)：当前生产532文件，未发现非法命名或完整实现副本，无须改名或删除生产文件。四个名称命中均有精确路径说明；9组同名模块中，index.js/mod.rs是作用域公共入口，其余7组经过职责核对。新出现的同名组需要明确说明，重写旧架构基线或输出审计报告不能自动豁免。

| 命中 | 合法说明 |
| --- | --- |
| docs/audit/windows-validation-final.json | 已归档Windows验收决定，非并行产品实现。 |
| docs/rewrite-progress/stage-02/02-11-old-shell-cutover.md | Stage 2退役旧壳的历史记录。 |
| 两份stage-09-final-sync-legacy-removal.test.mjs | R9-12迁移任务名称；分别检查架构缺席和实际同步/销毁行为，内容与职责不同。 |
| 两份command-registry.js | App负责类型化命令ID和单处理器解析；Shared负责注入的回调批次、原子注册与终止销毁。接口、实例和使用者不同。 |
| Rust search/paths/writer/types/validation/command同名组 | 作用域区分Tauri适配器与索引算法，文档存储与JSONL日志，以及文档ID/链接/HTTP各自的请求契约。逐路径职责和状态所有者已列入审计。 |
| desktop-schema/windows-schema相同JSON | Tauri生成的两个目标schema元数据，非重复执行模块，继续按09已确认边界保留。 |

生产入口、UI、模型、Rust、数据格式、依赖与构建配置均未修改。文件名中的领域动词不等于临时实现；实际Document Open中的activateNew/commitNew表示创建文档，不做机械替换。没有新增生产依赖、删除API或清理动作。

## 验证与状态

新增14项命名/副本/作用域契约：目录与复合名称、日期和副本编号、合法历史/领域词、Windows大小写冲突、JS/Rust副本、空模块正控、新同名模块审查、未跟踪生产发现、基线重写拒绝、CLI失败与原文保留、当前职责审查、审计漂移、缺少必要材料传播失败。

接入前12/14通过，旧Generated Files门禁未拒绝日期/重复模块，且本阶段审计尚未生成；明确接入单一检查并生成报告后复验，保留失败日志。接入后相关55/55、补齐指纹与清单后77/77通过。全仓2808/2808通过（371文件、16目录，失败/取消/跳过均0）；比10净增14项，无删除或弱化既有场景。全仓后自查复现archive.old目录及config.copy文件被扩展名剥离漏查；改为检查完整路径分量，并补齐点号目录、无常规扩展名、复合副本编号、附连日期和时间戳样例。最终受影响链路及证据77/77再次通过，四门禁按最后源码复验；不将此前全仓结果冒充已覆盖这些补充样例。CI保留此前全部累计链路，新增14项专门步骤与只读审计输出。

当前审计覆盖1359个跟踪路径、532个生产文件、591个实现候选，非法名称/完整实现副本/未说明同名组均0；4个历史名称和9组同名模块均有说明。267项风险指纹、1105个删除清单输入、10份受保护源码哈希及R12/R15/10验收保持一致。实际构建指纹7b27e96f2b414c4fb09979bf6942470cf7aabd3a1eaceaa4024bbd7b60bc4a78，473输入/136输出逐项核对通过，与10产品来源相同。

日志保留于系统Temp：mdr-r1611-before-integration.log（12/14）、integrated.log（55/55）、contracts.log（77/77）、repository.log及repository/repository-audit（2808/2808）、dot-component-before.log（漏查复现）、final-contracts-complete.log（最终77/77）、final-gate-*.log（最后四门禁）；上述后缀均以mdr-r1611-开头。

10正式验收保持，11尚待精确实现提交Windows CI；不提前勾选11，不进入12。推送后停止CI轮询，由用户提供结果或要求查看。

## 恢复

可从aac985b逐文件恢复本次治理代码、测试、CI和记录。生产文件与持久化数据没有迁移，不清理原文、日志、缓存或本机生成目录。
