# R15-13 清理日志

2026-10-23，用户要求“12 CI通过 可以收尾开始13”。R15-12实现44da71a / CI39943187508七组Windows与全部步骤通过，精确提交汇总accepted=true和下载摘要已核验；收尾基线`bb0c585eabfc014f2689cbebd30561051e912baf`。继续唯一`agent/r15-stage`，本项只清退仓库开发日志并加强生成文件门禁；不改产品、UI、冻结模型、Rust、依赖、构建配置或E2E行为，不进入阶段16。用户已有AGENTS.md末尾换行改动保留且不提交。

## 仓库日志清退

原仓库跟踪两份logs/performance开发JSONL，分别37698和118805字节；根gitignore仅有通用的.log规则，没有忽略logs目录。这两份日志还是当前生成文件基线的精确豁免，因此原门禁允许继续保留，也可被重新生成基线再次豁免。

逐个对明确路径执行`git rm --cached`，只移除Git跟踪，原磁盘文件保留且SHA256前后相同；未执行文件或目录删除、递归清理或历史重写。根`.gitignore`增加`/logs/`，当前Git索引中logs条目为零。新的提交/检出不再携带这两份开发日志；历史提交仍可读取原证据。合法的src-tauri/tests/fixtures文档journal JSONL不属于开发日志，保持跟踪和行为不变。

`tests/architecture/fixtures/architecture-baseline.json`的当前豁免从4项减为2项，仅移除两份logs条目，既有.vite精确豁免保留。`auditCorrections.r15RuntimeLogRetirement`记录原路径、字节数、Git blob与SHA256和基线提交；旧总数检查映射为当前2项加明确清退2项，保留原总数4的历史证据。R15-01事件目录中的trackedLogEvidence是历史快照，继续保留原记录，通过历史Git对象验证其摘要，不要求工作区重新携带原始日志。

## 不可由基线豁免的门禁

继续由现有`scripts/architecture/checks.mjs`的公共`checkGeneratedFiles`拥有检查，无第二套清理器或空壳转发模块。任何已跟踪的根logs目录条目均报tracked-runtime-log，包括强制加入、任意扩展名、嵌套路径和大小写变体；活动基线含logs条目则报runtime-log-baseline-exemption，重新生成基线也不能放行。

使用Git自身check-ignore解析根logs目录的规则、否定和来源，要求有效规则来自仓库根.gitignore。仅忽略jsonl扩展名、明确撤销目录规则、本机.git/info/exclude或全局规则均不能替代共享目录规则；Git检查失败明确报错，不静默接受。其他生成文件的新增拒绝、精确豁免移除检查、旧迁移后缀检查和CLI非零退出保持。

测试夹具默认提供根目录忽略规则；旧“新增日志”测试改为强制加入后检查不可豁免的日志错误，同时继续覆盖非法后缀、CLI输出和退出。未移除原失败场景，新增专项覆盖非日志生成物及合法journal正控。检查无持久状态、监听器或清理动作；同步Git查询不持有后续子进程。

## 验证与交付

先新增17项专项，在旧实现上5通过、12失败，证明原门禁允许已有日志豁免且不要求共享目录忽略。实现后专项17/17通过；包含原架构工具与阶段01交接检查的相关23/23通过。实际基线重新生成后CLI仍拒绝强制加入的日志；本地两份日志字节保持，真实Git目录忽略生效。证据位于临时目录mdr-r1513-before.log、mdr-r1513-unit.log、mdr-r1513-related.log和mdr-r1513-retired-logs.json。

最终本地验证：正式全仓入口`npm exec --offline --call "node scripts/ci/run-repository-tests.mjs"`覆盖358测试文件/16目录，2685/2685通过，无失败、取消或跳过；四项架构门禁、126项当前源码指纹、语法和差异检查通过。实际Git索引无logs条目，共享忽略生效，两份本机文件原字节保留，历史R15-01日志SHA256从其基线Git对象核验一致。历史R12 acceptance与R15-12正式验收对象经结构化比较未改写。R15-12已有505项输入/140项输出的产品构建仍通过当前指纹准入；本项产品/构建/E2E/原生相关路径的Git差异为零，未重复本机构建、浏览器或原生功能回归。累计证据位于mdr-r1513-repository.log。产品构建输入、E2E页面和原生实现未改，沿用R15-12精确提交已通过的75项实际页面及Windows原生证据，不冒充本轮重新执行。CI增加独立log-cleanup.log步骤，原七组和全部旧门禁保持；本项精确提交Windows验收未完成，15.13不勾选、阶段15不标记整体收尾。推送后按用户要求停止轮询CI。

## 恢复

回退本项实现提交可恢复索引条目、原豁免与旧检查；两份日志本机原文件已保留，历史Git对象也保留，无产品数据迁移。恢复跟踪属于明确回退操作，不代表日常允许重新提交开发日志。临时测试夹具不执行递归删除。R15-11独立图片菜单UI焦点发现仍开放，本项未修改或声称修复。

## 正式验收与阶段15交接（2026-10-23）

实现提交`5c50f9c5a2c2c27348eb8ebd3088409e22df488a`的[Windows CI39946123945](https://github.com/uniquenesssta/mdr/actions/runs/39946123945)七组及全部步骤通过：日志专项17/17、前端1678/1678、全仓2685/2685、浏览器11/11与75/75、Rust298项；原生链接、实际WebView、依赖与最后聚合门禁通过。小型收尾归档12497489814已下载，SHA256 `86e164eac999d86666e4a4b528890669865ca165863d5cd2e32a53894b0e6c41`与GitHub摘要一致；内部commit/运行号匹配、accepted=true、358测试文件/16目录、Rust298项。其余归档由最终CI任务校验，不声称本机下载全部归档。13正式验收收尾。

阶段15的13项Atomic均已有各自精确提交Windows验收，本次累计再次覆盖Recorder、递归脱敏、Aggregation Buffer、Long Task、Snapshot、Sink、Lifecycle、Query、显式安装、Runner和stale-dist。A04按15.4/15.7约定在进程内确认、有界队列/退避/重试和销毁范围关闭，不承诺跨进程exactly-once；A01真实前端至Rust/JSONL脱敏与release无日志继续通过。默认不创建E2E全局，显式启用具备动作/查询及退出清理；当前无已跟踪开发日志。冻结模型、数据格式和依赖未改变，所有步骤维持原质量门槛。阶段15范围验收完成，可以接收用户已授权的R16-01。

交接公共入口为features/telemetry、features/e2e及测试application-driver；状态/生命周期仍分别由各已验收Recorder/Buffer/Observer/Snapshot/Sink/Lifecycle和Query/Bridge拥有。剩余classic Runtime及兼容端口、两份历史.vite精确豁免按R16任务书审计，不因其路径含旧名就认定可删。工作区本机忽略日志按用户约束保留；阶段15门禁已证明它们不再入库，不为清理而批量删除。独立图片菜单真实鼠标关闭后的焦点问题保持开放，属于产品UI，后续修复需Figma要求与相应授权，不声称本次CI消除了此发现。

用户要求“收尾13开始 R16-01”：下一阶段仅冻结候选清单，逐项核对import graph、HTML、测试、构建与Rust mod graph；仍有引用或不能证明安全的候选必须禁止删除。阶段分支codex/r16-stage从本正式收尾提交创建。R16-02及后续未获本次实施授权，不执行文件删除或产品行为修改。
