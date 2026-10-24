# R16-05 CSS 清理

## 范围与基线

用户要求“收尾04开始05”。R16-04在804950f / CI40060322282精确Windows验收通过，收尾基线d98f713a9ab4588f220811bf3acc652f6af1b8bf；继续唯一codex/r16-stage，仅实施16.5，16.6未开始。用户AGENTS.md既有修改不纳入提交。冻结模型、数据/版本/偏移语义、Rust、存储格式、依赖与锁文件保持。回退使用本项实现提交的git revert，不能重置用户工作。

## 实际清理

main.css已在2.9删除，index.css已有51个有序import且没有实际规则；本项核对并保留，不伪造重复删除。现存CSS已经使用规范命名，本次删除App Shell的13种旧查询class（14个节点token实例），保留l-*、f-*、ID、role、aria及节点关系。生产main、布局偏好、E2E查询、窗口拖动自动化全部切换到相同节点的规范class。网页提取器用于识别第三方网页的.sidebar以及Outline折叠树自身的.collapsed不属于应用壳兼容钩子，保留其实际职责，不机械全文替换。

移除布局及Link Preview中10种旧状态别名：collapsed、hidden、resizing、sidebar-resizing、dragging、compact-shell、compact-split、page-fullscreen、page-fullscreen-active、link-preview-open；现有is-*与has-link-preview保持唯一投影。同步切换Preview Layout Stability、运行时布局快照和工具栏隐藏检测，避免只移除写入而遗留读侧。状态权威、持久化键/值、断点860/900及720/760、指针捕获、焦点、事件/销毁和Geometry通知均保持。

app-shell.css合并相邻的.l-app-shell规则并移除重复height声明；用PostCSS对旧/新同选择器的最终声明逐项核对一致。其余CSS不改，完整249条自定义变量审计未发现同一规则内重复；light/dark及media作用域覆盖、同值但语义不同的token不能当重复删除。测试使用现有Vite锁文件中的PostCSS，无新增依赖。没有视觉、主题、布局、文案或交互设计调整，已核对Figma规则，本项无需创建或重做设计；独立Image Menu指针焦点发现继续保留原UI/Figma交接，兼容业务端口退出仍归16.8。

## 断言迁移与失败记录

旧App Shell class精确断言→规范class及零旧钩子；仍验证相同命名refs、树结构、ARIA与精确恢复原节点。旧状态class出现→对应规范状态出现且旧别名缺席；仍验证原状态、持久化和失败返回、ResizeObserver/RAF/订阅/指针捕获销毁。预览假DOM和独立浏览器夹具改用is-collapsed；新增非零几何仍折叠时不得渲染、显式重开后恢复并可销毁的回归。原生窗口自动化的菜单条查询同步迁移，不声称本地已运行物理窗口拖动。

新App Shell零旧钩子回归先在旧实现失败，实际检出14个旧token实例；迁移首轮29项为24通过/5失败，均为旧状态class断言或仍设置hidden的工具栏测试夹具，按上述映射迁移，未删除场景。新增预览测试首轮模拟同尺寸ResizeObserver却期待重开刷新，63/64；调整为实际所有者的显式requestRefresh重开，未改变生产阈值或放宽断言，64/64通过。新增加3项回归（零旧壳class、规则内重复变量负控/合法主题覆盖、规范折叠可见性），全部真实生产模块及原场景保留。历史Stage 2盘点JSON/任务记录不改写，当前证据生成器如实标注R16-05已退役的旧壳钩子。

## 当前验证

CSS/布局/Preview专项64/64，浏览器契约11/11；生产构建通过，main586.23KB，500000/700000字节预算不变。最终完整页面及全仓复验结果见下方，R16-05待本提交完整Windows累计CI，尚未验收。推送后停止查询CI，16.6未开始。

最终生产包实际页面75/75通过，console/exception均0，包含原始HTTP资产、零旧壳class、全屏仅规范状态、六组响应式视口、主题、折叠/拖动、Preview及完整导出回归；浏览器契约11/11，Node24.19.0/Undici7.29.0。生产来源指纹6949481349c47d036b85e797d0e46d50700c742d7fa800687941aa869ae834f3（511输入/137输出）；10项受保护模型源保持，230项当前风险源核对。删除证据1132输入/104候选，37已缺席、59有引用、6受保护、2未证明；全部deletionAllowed=false，无文件删除。

本项不重复未受影响的Rust本地全量及原生大文档链，04的301项Rust和原生大文档4路只作已验收基线，不冒充05同提交证据。新实现必须通过完整Windows累计CI（保留真实WebView/大文档/原生写入门禁）；物理窗口拖动未在本机重做。16.5尚未正式验收，16.6未开始。

全仓首轮2742通过/1失败：R15事件目录对Compact Shell仍直接比较原文件SHA，随后定位同根的Toolbar Boundary与Preview Layout Stability。保留原43源及全部历史SHA、事件/字段/噪音/A04状态；三处沿已有迁移规则从固定基线读取原文核对SHA，并新增精确全文变换断言：只允许移除旧compact-shell投影、hidden→is-hidden读取、collapsed→is-collapsed读取，事件生产代码其余每个字节必须相同。该验证不是放弃当前源检查，当前风险源SHA也更新并继续硬校验。R15专项24/24通过；未修改event-catalogue.json及历史夹具，修复后须完整复验。当前风险源仍为230项，已刷新对应迁移证明SHA。

## 最终交付验证

最终全仓2743/2743（362文件/16目录），失败/跳过/取消0，所有目录退出码0；CSS64/64、事件目录24/24、浏览器契约11/11及生产页面75/75通过，四项项目门禁通过。230项当前风险源及10项冻结源核对；原43源历史事件目录、阶段验收、R12政策及锁文件保持。最终全仓证据Temp/mdr-r1605-repository-tests-final.log与mdr-r1605-repository-final/repository-audit；首轮2742/1记录保留。

补齐历史事件迁移证明仅修改测试及审计记录，未触及生产构建输入，75项实际页面及来源6949481349c47d036b85e797d0e46d50700c742d7fa800687941aa869ae834f3仍对应最终产品。已实现/本地验证通过与阶段验收分别记录：R16-05尚待新提交Windows完整CI，不勾选，不进入16.6。推送后不轮询。

## 正式验收（2026-10-24）

实现提交d072309ff623cd0118498da679b2aafbf3b21a66的[CI40066385721](https://github.com/uniquenesssta/mdr/actions/runs/40066385721)七组Windows及全部步骤成功。同提交closeout accepted=true、run与commit匹配；全仓Node2743（362文件/16目录）、CSS64、Rust301、浏览器11＋75及四门禁通过。实际WebView安全边界、导入8场景、大文档4路、原生图片及四格式写入通过。05正式收尾；此前2742/1与类名专用迁移证明的修复记录保留。

归档12548854065（closeout，10725字节）SHA256=dc5ebb78c50fa21e85f1b1a7eb6e04f4849fc89f90399a0f31e3a1ea23d38266；12549532669（WebView，1357400字节）SHA256=736ca8e21566c873d68dd321f0a10c87b8c3a9224929755641936c41e1a434b1，均已下载核对一致。

按用户“收尾05开始06”，继续唯一codex/r16-stage执行16.6，核对并切换已目录化原文件的全部调用者，不保留旧路径wrapper。16.7未开始；冻结模型、用户已有AGENTS.md修改和既有UI交接保持，推送后停止CI查询。
