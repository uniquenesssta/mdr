# R15-06 Runtime Snapshot

唯一分支 `agent/r15-stage`；基线a9be96d / CI38425603742。R15-05七组Windows及全部步骤通过，长任务39、Buffer41、脱敏33+真实payload3、Recorder22、目录24、递归Node2373、前端1366、浏览器11+67、Rust281；三份下载归档摘要与同提交最终accepted=true核验，正式收尾。06首轮未通过，修复后等待新的精确提交Windows验收，15.7未开始。

## 首轮失败与限定修复（2026-10-14）

7617f5c / [CI38507035518](https://github.com/uniquenesssta/mdr/actions/runs/38507035518)未通过：快照50/51，递归Node2423/2424，前端1416/1417；同一实际Recorder→Buffer断言期待editor却得到[redacted]。生产main-ri4l76Qn.js为703542字节，超过保留的700000 async门槛3542字节，导致前端和Windows WebView构建拒绝；实际浏览器启动等待超时属于构建失败的后续阻断，不能算67场景通过。浏览器契约11、此前长任务39/Buffer41等目标步骤及三组独立原生/Rust/依赖作业成功；最终汇总按失败拒绝。

脱敏仍唯一归公共Redaction：仅为scrollSourceSide加入editor/preview/空串的精确集合，路径、自由正文、伪造大小写等继续屏蔽。原失败的editor断言保持，另加一项实际Recorder安全/非法枚举回归。Runtime快照改为惰性获取一个公共所有者，只有DEV自动分支引用创建/start；release配置LogsPort不创建所有者。fixture用optional销毁/state读取未创建实例，原手动sample接口仍可显式创建并采集。生产窗口没有暴露该测试入口。

主包超限通过DEV可裁剪装配处理，未提高任何阈值、拆移无关业务、调整依赖或删除场景；实际修复包体及完整功能仍待新提交Windows复验。快照实现、原51项场景名称、全部累计CI步骤与558模块保持。原生脱敏兜底对齐同一字段的精确三值集合，现有Rust直接脱敏和真实frontend→command→JSONL读回增加侧别断言，原生日志协议/格式不改。风险清单新增该原生规则源至93；原92来源保持。目录43个历史SHA仍按原基线核验，已迁移Runtime与此次原生规则读回原Git版本，当前代码由风险SHA、新边界断言及实际行为约束。

## 有界快照所有者

公共入口导出 `createRuntimeSnapshotRecorder`，`runtime-snapshot-recorder.js` 唯一拥有快照字段投影、DOM计数策略、采样重入/代次屏障和周期计时器。旧Runtime的完整快照算法及不可销毁的snapshot interval删除；Runtime只注入Document、内存、视口、Buffer.getStats、同步统计、Recorder.record和计时器能力。构造不采样、不安装Timer、不读取浏览器全局、不写文件。

DOM使用Document作为TreeWalker根，只遍历SHOW_ELEMENT。默认最多推进10000个元素，可降低预算，禁止扩大上限；不创建`querySelectorAll('*')`的全量NodeList，不读取节点正文、属性或路径，不持有节点/列表/来源状态。未到上限则输出精确元素数；达到上限输出预算值及domNodesCapped=true，表示达到采集预算，不能据此推断恰好上限还是更多。能力缺失/遍历异常输出domNodes=null；不退回无界查询。

每次各读取一次DOM、memory、Buffer、viewport、runtime五个同步来源；固定22个字段，包含原21字段及新增domNodesCapped。内存只取usedJSHeapSize/totalJSHeapSize，未知或非法输出null，合法0保留0。queue、aggregate、overflow entry/sample、unconfirmed、acknowledged及同步计数只保留非负有限数，取整数并封顶MAX_SAFE_INTEGER；非法输入归0，字符串/对象不强制转数值。scrollSourceSide仅editor/preview或空串。额外属性、函数、循环对象、正文和路径不枚举、不复制。

字段/来源异常输出固定安全phase及对应未知/默认数值，其余来源继续采集；不输出异常文本。sample在端口读取或属性getter重入stop/destroy后不再读取其他来源或发布；重复同步sample拒绝重入。记录仍由实际公共Recorder进行脱敏并经Buffer确认，不新建第二套事件/隐私/日志所有者。

## 计时器与Runtime接入

提供显式sample/start/stop/destroy及只读getState。start只安装一个30秒计时器，第一次采样在首个周期；后续完成采样再安排一个继任Timer。可配置周期范围1000～300000ms，不形成短间隔忙循环。重复start不增加Timer；stop失效代次并取消Timer，destroy永久阻止手动、周期或再次启动。stop之后仍允许显式手动sample，保持原Runtime测试/诊断调用语义；destroy后全部采样关闭。

调度失败可在显式后续start恢复；取消失败标记cleanupFailed并阻止创建可能重叠的Timer。迟到旧Timer在逻辑上失效且不再采集或安排继任；宿主拒绝取消时不能宣称其物理计时器已成功清理。计时器端口使用异步单次调度语义，来源端口为同步只读采集。

实际Runtime的DEV+LogsPort门禁控制快照所有者按需创建与自动start/stop；pagehide停止、pageshow按启用状态恢复。release不自动采样或创建Timer，不安装性能全局；已有显式手动快照调用保持。长任务既有39契约保持，事件/导航Observer、DOM监听及另外两个旧周期drain/flush继续归15.8统一Lifecycle，本项不声称完整应用已销毁。A04原生确认、幂等和真实部分append仍待15.7，未关闭。

## 验证与保留边界

原51项公共契约保留，并增加1项精确侧别枚举与非法值脱敏回归，共52项：十项依赖、六项预算/周期限制、无构造副作用、固定schema与五来源各读一次、无限/空/低于/等于/高于预算DOM、缺能力与遍历错误、五来源异常、合法零/非法/巨大计数、隐私循环对象、属性getter、单Timer/重复启动、禁用/停止/重启/销毁/迟到回调、调度/取消/记录失败及重入、实际Recorder→Buffer receipt，以及实际DEV Runtime的10000预算/同步统计/pagehide/pageshow/禁用/销毁和release手动兼容。

Runtime夹具注入真实公共Recorder、Redaction、Buffer、LongTaskObserver和RuntimeSnapshotRecorder，浏览器DOM/Timer端口只服务确定性的能力/预算/生命周期故障验证。该夹具不证明真实Windows浏览器每次DOM扫描耗时；原11+67浏览器与真实Windows WebView链继续保留作为累计产品验证。VM源码加载仅服务剩余Runtime装配，15.11统一移除。Rust实际frontend→desktop→JSONL生产者只增加公共工厂注入，原三条payload、原生命令与输出格式保持。

公共入口/风险清单增加一个模块：生产558模块、初版风险来源92（修复后93），旧行及冻结属性保留；七组Windows及原步骤保持，只新增telemetry-snapshot.log步骤。R15-01目录24、Recorder22、Redaction33+payload3、Buffer41、长任务39和全部累计场景保留。冻结模型、依赖、体积门槛、原生接口/日志协议、E2E runner和67实际页面场景不变；此次修复仅对齐原生脱敏三值枚举并增强既有Rust断言。本地仅静态/语法/来源/文档/测试注册；功能、构建、浏览器与Rust待本次精确提交Windows CI，06尚未验收。

## 插件与接口依据

按AGENTS.md调用Context7查询浏览器内建TreeWalker；无新增依赖包。`/mdn/content`确认Document根、SHOW_ELEMENT=0x1及nextNode推进/返回null语义，预算由本项目显式控制。依据：[createTreeWalker](https://developer.mozilla.org/en-US/docs/Web/API/Document/createTreeWalker)、[nextNode](https://developer.mozilla.org/en-US/docs/Web/API/TreeWalker/nextNode)。原performance.memory只作为可选来源；不可用不假造堆大小。

Mermaid Chart已渲染实际采集与周期状态图：

```mermaid
flowchart TD
 A["显式采样或 DEV 周期回调"] --> B["固定字段采集"]
 B --> D["DOM 迭代最多 10000 元素"]
 B --> M["内存、队列、视口和同步标量"]
 D --> G["代次有效性检查"]
 M --> G
 G -->|仍有效| R["公共 Recorder 脱敏并交给 Buffer"]
 G -->|停止或销毁| X["放弃本次发布"]
 S["启用 start"] --> T["单个 30 秒计时器"]
 T --> A
 R -->|周期模式仍启用| T
 H["stop 或 destroy 或 pagehide"] --> C["取消计时器并失效代次"]
 C --> X
```

初版提交前静态记录：四项架构/生成/文档门禁、6个JS/MJS语法、164个相对文档链接、92个风险来源blob SHA通过；历史审计根记录与历史前缀、558模块旧行、七组CI及全部旧步骤、受保护文件和README历史保持。注册51+39+41+33+22+24=210项，未执行功能回调；五项公共职责边界及两项原目录来源/元数据静态契约通过。06功能与累计产品验收等待本次精确提交Windows CI。

修复来源核对：前端与原生仅允许editor/preview/空串，原生直接检查还覆盖大小写伪造、路径和正文拒绝；真实生产者生成的3条payload数量保持，Node与Rust原有场景增强合法值/非法值读回。Rust格式、功能及原生回读全部由Windows复验，不在本地执行。

修复接口依据：锁文件Vite7.3.6未改，Context7查询Vite7官方[env-and-mode](https://v7.vite.dev/guide/env-and-mode)确认DEV静态替换及开发分支裁剪；未将文档语义当成实际包体通过证据。Mermaid Chart已更新真实DEV/测试手动入口与单一所有者装配图。当前本地功能/构建/浏览器/Rust不执行，全部等待Windows。

修复最终静态复核：四项门禁通过；7个变更JS/MJS语法、165相对链接、93风险来源SHA通过。原51快照及所有前序场景名称/顺序保持，注册总211；工作流、阈值、依赖锁、558模块清单与43目录指纹原文件逐字节保持。所有本地功能回调、构建、实际浏览器及Rust均未执行，修复仍待Windows验收。
