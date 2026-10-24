# R16-07 Runtime清理

## 范围与基线

用户要求“收尾06开始07”。06已在5a3bb9befed21010a6f3640e9c79c53e97f380a1 / CI40069504230精确验收，从收尾2b955f8ef69412e7f16bced71c47e9dcb0fb51cc继续唯一codex/r16-stage，仅实施16.7。用户已有AGENTS.md修改保留，不纳入提交；16.8兼容路径与后续未开始。冻结模型、UI外观/交互、原生边界、磁盘格式、生产依赖和锁文件保持。回退使用实现提交的git revert，不重置用户文件。

## 逐项职责和调用切换

| 已移除路径 | 唯一新路径 | 当前公共入口 |
| --- | --- | --- |
| src/runtime/performance.js | features/telemetry/browser-telemetry.js | features/telemetry/index.js |
| src/runtime/e2e-bridge.js | features/e2e/browser-e2e-bridge.js | features/e2e/index.js |
| src/runtime/link-preview.js | features/link-preview/link-preview-controller.js | features/link-preview/index.js |

三份文件逐个迁移，旧路径无wrapper，Git跟踪集合中src/runtime为空，原已退休tauri/task-scheduler/vendor未重新创建。Telemetry继续组合Recorder/Buffer/LongTask/Snapshot/NativeSink/Lifecycle；E2E浏览器能力与中立安装/查询所有者分离；Link Preview保留单实例overlay/导航/focus/visibility/frame所有权。单一生命周期明确，未为了文件数拆分共用状态，也未在清理期重构视图/策略。Hybrid内已明确职责的功能能力容器仍归其自身，不属于通用src/runtime堆积。

main统一从三个功能公共入口调用。功能内部直接依赖同功能模块，避免barrel循环；Link Preview使用原DOM/Icon能力且完整函数体不变，E2E DOM/安装能力完整函数体不变。Telemetry完整函数体保留，只将原DEV自动启动块变为mountPerformanceTelemetry显式入口，增加重复挂载与销毁后的拒绝，main在创建Platform前调用；公共入口导入不安装监听器/观察器/全局E2E。现有开发日志、生产默认无自动日志、快照/聚合/重试/确认、pagehide/bfcache和终止清理保持。

## 测试意图、历史证据与门禁

迁移前106/106通过（Telemetry Lifecycle、E2E安装、Link Preview所有权），日志Temp/mdr-r1607-before-tests.log。迁移后同组加8项新门禁114/114通过，另201项核心契约、脱敏34项通过。现有22个测试/辅助文件只切换当前实现位置与公共入口；VM辅助继续注入实际公共协作者，并显式调用挂载，不读取历史替代实现。Windows/Rust前端JSONL生产器仍执行实际当前源码和实际客户端。

8项新增覆盖三份完整实现与收尾基线对比（Telemetry仅允许明确挂载变换）、所有生产旧runtime引用退出、静态/动态/再导出复活负向拒绝、真实Node公共入口无浏览器全局冷导入、DEV重复挂载仅一次bootstrap/销毁终止，以及生产挂载零自动资源。R15冻结43源事件目录保留原路径/SHA，只为当前生产者建立路径映射；R12原始performance SHA用原验收commit核对并记录迁移，旧验收不改写，closeout测试仅将已授权R16.7纳入原有迁移证明分支，仍要求精确历史SHA和已审查替代源。

生产集合571项（唯一新增Link Preview公共入口），234当前风险源；1136输入快照中104候选（44已缺席/52有引用/6受保护/2证据不足），所有deletionAllowed=false；10冻结源待最终复核。旧阶段3生成器和已明确停用R12 Linux工作流中的旧路径属于历史审计，不恢复执行、不改写历史；现行Windows全部累计门禁保持，新增07专项。

本项已实现且本地验证通过；待新精确提交Windows累计CI后验收，不勾选16.7。

## 实际开发模式与首轮修正

新增真实Vite DEV页面启动回归：原应用app-ready、公共入口重复挂载被拒绝，实际日志Sink收到1个frontend.bootstrap；运行时11资源/3控制监听器，销毁后资源/监听器/定时器/帧均0、cleanupFailed=false，销毁后挂载被拒绝，无旧性能全局，显式E2E仍可用。此为真实开发页面与当前模块，不以VM替代；原生Sink/Windows链仍需新CI。

直接相关首轮486/487唯一失败是SVG测试仍绑定原UI相对路径，更新为相同Icon能力的新相对位置后3/3通过；未改图标、数量、行为或门槛。DEV首轮日志/清理断言均通过，新增E2E可用断言误写不存在的getSnapshot，按现有公共snapshot方法修正后1/1通过。首轮mdr-r1607-affected-tests.log和mdr-r1607-dev-browser.log保留，最终真实DEV证据mdr-r1607-dev-browser-final.log。

生产构建通过：main585.89KB，预算500000/700000字节保持，512来源输入/137产物，SHA256=0055c7cb230ec564884caae5b9104b2f75d98e483244bcb8535f2cdb35cefbe9。新增实际DEV回归后为9项新场景，待完整累计验证。

## 累计交付验证

生产浏览器契约11/11、实际页面75/75通过，built-app-diagnostics中控制台错误/未处理异常均0；新真实DEV页面1/1通过，四项项目门禁通过。512输入/137构建产物与最终源码来源一致，main585.89KB，未改变包体预算。完整Node回归2759/2759通过（365文件/16目录），每组退出码0，失败/跳过/取消均0；包含当前真实DEV页面与实际Link Preview焦点回归。

日志：Temp/mdr-r1607-before-tests.log、mdr-r1607-initial-contracts.log（201）、mdr-r1607-runtime-contracts.log（114）、mdr-r1607-redaction-tests.log（34）、mdr-r1607-sprite-tests.log（3）、mdr-r1607-dev-browser-final.log（实际DEV）、mdr-r1607-build.log、mdr-r1607-browser-contract.log、mdr-r1607-browser-app.log、mdr-r1607-browser-app/built-app-diagnostics.json；首轮日志保留。

本项Rust/IPC、数据格式和依赖保持，未重跑完整本地Rust与原生WebView；06的301项Rust及四路大文档CI仅作基线。07必须由新精确提交Windows累计CI复验后验收，当前不勾选，不进入16.8，推送后停止CI轮询。

最终审查：234项当前风险源、1136输入删除清单、10项冻结源及571项真实生产集合核验一致。原43源R15事件目录、R12政策/历史验收、06正式验收、锁文件与用户AGENTS.md保持。完整回归证据Temp/mdr-r1607-repository-tests.log和mdr-r1607-repository/repository-audit/{test-inventory.json,suite-results.json}；新增真实DEV页面日志亦在全仓结果中。浏览器使用bundled Node24.19.0/Undici7.29.0。

## 正式验收（2026-10-24）

实现提交9d206b6bf11b1951e1442dce4a17ed8943c939c1的[CI40088353919](https://github.com/uniquenesssta/mdr/actions/runs/40088353919)七组Windows及全部步骤成功。同提交closeout accepted=true、run/commit匹配；全仓Node2759（365文件/16目录）、Runtime专项114、真实DEV1、Rust301、浏览器11＋75、四门禁、真实WebView安全/导入链、大文档4路、原生图片和四格式写入通过。07正式收尾，首轮SVG路径与新增E2E方法名断言修正历史保留。

归档12557604944（closeout，10890字节）SHA256=d48558eac56fa9cfba33744f11997ba2a8a075ee590639e6794f48f29760b242；12558450284（WebView，1348398字节）SHA256=26f9c800a4d3c19859cc65b6e6c2a97c7db05622713e7ca7f2ee874704a3f746，均已下载核对一致。

按用户“收尾07开始08”，继续唯一codex/r16-stage实施16.8兼容路径清理，16.9未开始。用户既有AGENTS.md修改、冻结模型及既有UI交接保持；推送后停止CI查询。
