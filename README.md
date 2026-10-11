# Markdown Editor

Stage 14：`agent/r14-stage`；R14-01～08已验收（08：22cbd68 / CI38072508148），七组及全部步骤通过，全仓1848/1848、前端843/843、样式21/21、启动生命周期12/12、浏览器11/11＋45/45，最终同提交准入accepted=true。首轮失败与修复证据保留。按用户指令收尾08并实施14.9：唯一公共Markdown Exporter接管原文快照/非当前文档读取、统一文件名与平台输出，补取消/过时/销毁边界；09首轮135f431 / CI38075521977仅非当前文档文件名预期失败，现补建档标题与导出名称映射，待修复提交Windows累计重验；14.9不勾选，14.10未开始。A10最终离线完整格式门槛及其余已接收职责保持。 [09实施](docs/R14-09-DETAILS.md) · [08正式验收](docs/R14-08-DETAILS.md)；历史见 [docs/README.md](docs/README.md)。

## Change Log

- 2026-10-11：R14-09首轮 `135f431` / [Windows CI38075521977](https://github.com/uniquenesssta/mdr/actions/runs/38075521977) 全仓1878/1878、前端873/873、新原文契约30/30、浏览器11/11＋47/48，其余五组成功；汇总正确阻断。唯一失败是测试将建档输入selected source.docx当作保存标题，现明确Documents先追加.md、Export保留现有正确后缀，并严格核对输入/创建/存储/下载四个值；补三项名称对照，原文、状态和全部场景/准入门槛保持。产品/依赖/工作流不变；静态复核后同分支Windows重验，09未验收，10未开始。[失败与修复](docs/R14-09-DETAILS.md#首轮失败与修复2026-10-11)。

- 2026-10-11：R14-08在 `22cbd68` / [Windows CI38072508148](https://github.com/uniquenesssta/mdr/actions/runs/38072508148) 七组及全部步骤通过，正式收尾；全仓1848/1848（334文件16目录）、前端843/843、样式21/21、启动生命周期12/12、实际页面45/45与真实导入链8/8通过，四份归档SHA256和精确head一致，最终准入accepted=true。实际浅深色1080×2355 PNG对参考零差异、正控525252像素、Preview/Hybrid各两个原节点及可访问裁剪均通过，两张当前提交PNG已视觉核对。继续同分支14.9：全部Markdown入口迁至唯一公共Exporter，直接读取原文、不渲染，复用已验收平台安全写入与浏览器URL清理；新增30项契约、3项实际页面回归并累计保留原场景。09静态复核后交Windows CI，尚未验收，14.10未开始；字体离线、打印/图片后续职责、A10及独立Editor问题保持。[09范围](docs/R14-09-DETAILS.md) · [08证据](docs/R14-08-DETAILS.md)。

- 2026-10-11：修复14.8首轮验证接线：b9a565d / [CI38057924490](https://github.com/uniquenesssta/mdr/actions/runs/38057924490) 前端831/831、样式21/21、浏览器契约11/11、实际页面44/45；独立HTML/Word与1080×2355浅深色PNG零差异及可见文本正控通过，两张实际PNG已核对无额外公式文本。失败测试把隐藏图片正文算入Preview且未启用Hybrid，现切换真实布局、限定#preview/#editor，严格保留每界面两个公式及可访问裁剪/节点身份断言。Windows WebView断言前无窗口的底层原因未确定；补本次PID原生窗口屏障、诊断及部分会话/进程清理，只在未执行断言且进程存活、清理确认退出时允许一次新进程恢复。新增12项恢复边界回归，保留全部七组门禁、45项built-app和原样式/安全场景；产品/依赖/模型保持。静态复核通过；待新Windows CI，14.8不验收，14.9未开始。[详情](docs/R14-08-DETAILS.md)。

- 2026-10-10：R14-07在 `c532cd1` / [Windows CI38021008368](https://github.com/uniquenesssta/mdr/actions/runs/38021008368) 七组及全部步骤通过，正式收尾；全仓1815/1815、前端810/810、安全6/6、增强27/27、Builder21/21、浏览器11/11＋42/42，三个归档摘要已校验，首轮失败保留。继续14.8：HTML/Word复用唯一文档CSS，PDF/Image使用可释放样式作用域；显式加载锁定KaTeX样式，图片编码隐藏辅助MathML，保留文档/Preview/Hybrid可访问数学。新增21项样式契约和3项实际页面回归，包含独立文档、浅深色PNG与移除MathML参考的像素对照及可见文本正对照。静态自检后交同分支Windows累计CI，08及图片视觉结果待验收；14.9未开始，字体离线打包/旧CDN模板和A10最终格式门槛保持。[08范围与证据](docs/R14-08-DETAILS.md) · [07正式验收](docs/R14-07-DETAILS.md)。

- 2026-10-10：R14-07首轮 `a8b8302` / [CI37967189292](https://github.com/uniquenesssta/mdr/actions/runs/37967189292) 未通过：安全5/6、前端809/810、全仓1814/1815的唯一直接失败是宏污染已被ParseError拒绝，但测试写死另一条错误文案。改为错误类型及拒绝行为，并补错误HTML不含污染内容、显式自有宏仍可渲染，保留6项场景；产品/依赖/工作流不变。增强27/27、导出43/43、Builder21/21、浏览器11/11＋42/42及其余四组已成功；归档18份文本与实际1080×2563 PNG摘要已核对。PNG公式额外文本另登记14.8/14.16样式/图片验收，07与A10仍待本提交Windows累计重验，不开始08。[失败证据与修复](docs/R14-07-DETAILS.md)。

- 2026-10-10：06文档收尾 `f8d2312` / [CI37961049857](https://github.com/uniquenesssta/mdr/actions/runs/37961049857) 七组及全部步骤通过。继续同分支实施14.7：四种格式统一调用公共Preview Enhancer，任务列表/代码/数学/Mermaid按18个正文节点分批；Builder原始身份与版本不可变，取消/替换/销毁及晚到图表不能发布。删除经典增强函数与退休变量，新增27项增强、6项实际KaTeX安全和1项Builder来源回归，实际页面扩展到42场景。针对A10定向固定KaTeX0.18.2及传递override，Mermaid11.16.1与其余锁包不变，锁文件审计零公告；安全及产品结果待精确提交Windows累计验证。07不勾选、08未开始，离线模板/样式与后续格式职责仍接收。[07实施与独立依赖决策](docs/R14-07-DETAILS.md) · [06验收](docs/R14-06-DETAILS.md)。

- 2026-10-10：R14-06在 `1f49956` / [Windows CI37958151064](https://github.com/uniquenesssta/mdr/actions/runs/37958151064) 七组及全部步骤通过，正式验收：全仓1781/1781、前端776/776、Builder20/20、Settings5/5、导出43/43、浏览器11/11＋39/39及实际Windows导入链8/8成功。已校验最终汇总与前端归档摘要，实际137段长文无全文快照、48/96/138分批、首批取消后重建和两项主题身份检查均通过；保留三次失败与修复。仅登记验收、勾选14.6，14.7未开始；完整格式缺口、A10及独立Editor指标问题保持接收。[验收详情](docs/R14-06-DETAILS.md)。

- 2026-10-10：R14-06第三轮 `a3dadd6` / [CI37955921182](https://github.com/uniquenesssta/mdr/actions/runs/37955921182) 浏览器11/11＋39/39、导出43/43、Builder20/20及Rust/原生/WebView/依赖通过，前两轮实际导出与主题失败均已通过。全仓1780/1781、前端775/776、Settings专项4/5的唯一直接失败是新增测试使用不受支持的语言en-US；按现有Locale Registry修正输入与预期为en，保留全部场景和断言，产品与工作流不变。待同分支Windows累计重验，14.6未验收、14.7未开始。[详情](docs/R14-06-DETAILS.md)。

- 2026-10-09：R14-06第二轮 `4d5831e` / [CI37943920538](https://github.com/uniquenesssta/mdr/actions/runs/37943920538) 未完全通过：全仓1776/1776、前端771/771、导出43/43、Builder20/20及其余五组成功；上轮三个导出失败全部通过，实际18份文本产物、137段长文无快照、48/96分批与取消后重建均有归档。built-app37/39，两个主题场景失败：旧Settings监听对theme-only也重应用布局，清掉混合Preview；失败测试未恢复浅色，连带污染下一场景。按变更字段限定布局/偏好/侧栏刷新，追加5项实际监听器与公共Settings/Theme联动回归；原39场景和身份断言保持，补显式预览准备、状态JSON与finally恢复。静态复核后在同分支重验；14.6不验收、14.7未开始。[详情](docs/R14-06-DETAILS.md)。

- 2026-10-09：R14-06首轮 `ccef698` / [CI37935424278](https://github.com/uniquenesssta/mdr/actions/runs/37935424278) 未通过：全仓1771/1771、前端766/766、构建20/20及其余五组Windows job成功，built-app 36/39，收尾随之阻断。修复HTML/Word对退休escapeHtml的调用并移除VM隐藏注入；built-app改为原生同来源回环HTTP加载真实dist/Worker，保留完整长文、无快照、分批取消等原断言，增加5项回归与Worker资源200检查。归档失败截图、控制台/请求及断言前JSON；待同分支新提交累计重验，14.6未验收、14.7未开始，F01/F02/剩余F04和A10排期保持。[失败与修复](docs/R14-06-DETAILS.md)。

- 2026-10-09：R14-05收尾提交 `45bcdd1` / [Windows CI37931528219](https://github.com/uniquenesssta/mdr/actions/runs/37931528219) 七组及全部步骤通过。按“收尾05开始06”在同分支迁入公共Document Builder：优先复用已同步Preview块按96/48块分帧，回退显式模型快照与安全HTML节点；检查身份/版本/取消并释放待执行帧，pagehide先卸载构建能力再销毁依赖。删除旧全文构建函数，HTML/Word/PDF/Image全部切换；原41/31/16/22/20场景保留并映射新接口，新增20项构建、3项Preview捕获及实际长文/取消/销毁探针。四项静态门禁与语法/指纹/历史复核后提交Windows累计CI；本环境未运行产品测试、浏览器或构建。14.6未勾选、14.7未开始；原缺陷夹具不变，HTML/Word仍有未增强/独立模板缺口，PDF/Image旧增强/打印链及A10继续接收。[06实施](docs/R14-06-DETAILS.md) · [05验收](docs/R14-05-DETAILS.md)。

- 2026-10-09：R14-05在 `11d2eb4` / [Windows CI37929409192](https://github.com/uniquenesssta/mdr/actions/runs/37929409192) 七组及全部步骤通过，正式收尾：全仓1748/1748、前端746/746、进度20/20、新增预览竞态4/4、取消22/22、浏览器11/11＋38/38与实际WebView导入链8/8成功。上轮文件双栏渲染检查已通过，保留失败历史及其因果证据限制；进度状态、界面、取消和结束清理已验收，完整格式缺口及A10保持接收。仅更新验收文档和任务勾选，14.6未开始。[验收详情](docs/R14-05-DETAILS.md)。

- 2026-10-09：R14-05第二轮 `2dbfc2b` / [CI37897676407](https://github.com/uniquenesssta/mdr/actions/runs/37897676407) 全仓1744/1744、前端746/746、进度20/20及浏览器11/11＋38/38通过；唯一直接失败为真实WebView本地文件导入后的双栏渲染超时。修复Preview重复更新时取消旧增强队列却漏补复用节点的竞态，保留已完成预览快速路径，新增四项强制交错回归及分项DOM/失败截图证据；旧产物未记录缺失项，本次超时根因仍待重验。待新Windows七组CI，14.5未验收、14.6未开始。[详情](docs/R14-05-DETAILS.md)。

- 2026-10-09：修复R14-05首轮CI漏同步的旧迁移计数断言：`2bbd773` / [CI37890617533](https://github.com/uniquenesssta/mdr/actions/runs/37890617533) 进度20/20、取消22/22、任务16/16、请求31/31、导出41/41、浏览器11/11＋38/38及Rust/原生/WebView通过；全仓1743/1744、前端745/746唯一直接失败是Stage 1仍固定内联事件33，而迁出进度按钮后已为32。改查现有每个处理器及数量与精确基线一致，并证明退役按钮已移除、迁移记录保留；原历史交接与全部场景/硬门禁保持，生产代码不变，待新Windows累计验收，14.5未验收、14.6未开始。[详情](docs/R14-05-DETAILS.md)。

- 2026-10-09：R14-04在 `f631d26` / [Windows CI37886068643](https://github.com/uniquenesssta/mdr/actions/runs/37886068643) 七组及全部步骤通过，安全写入18/18、Rust格式、取消22/22、全仓1724/1724、前端726/726、浏览器11/11＋37/37，正式收尾。按用户“收尾04开始05”继续同分支实施14.5：Progress Store只读投影唯一任务状态，独立View接管进度DOM、ModalShell焦点/关闭、受控取消按钮和结束清空；移除经典订阅、进度模板/注册及内联取消全局入口，pagehide逐项清理。保留原41/31/16/22场景并接入新视图，新增20项生命周期专项和实际页面探针；静态自检后交Windows累计验收，14.5未勾选、14.6未开始。[04验收](docs/R14-04-DETAILS.md) · [05实施](docs/R14-05-DETAILS.md)。

- 2026-10-09：修复R14-04第二轮CI格式遗漏：`e050ff4` / [Windows CI37883007228](https://github.com/uniquenesssta/mdr/actions/runs/37883007228) 安全写入18/18（含强制同一时刻/已有目录并发回归）、全量Rust269＋5＋1＋6、取消22/22、全仓1724/1724、前端726/726、浏览器11/11＋37/37通过；唯一失败是Rust 1.88格式门禁要求新增两处断言换行，最终汇总正确阻断。按CI完整rustfmt输出修正两处布局，确认仅空白变化，四项静态门禁及文档/证据复核通过，生产行为、测试及工作流保持；本地Rust运行库不完整，采用CI输出逐项静态复核，完整格式门禁与累计Windows回归待新CI，R14-04未验收、14.5未开始。[详情](docs/R14-04-DETAILS.md)。

- 2026-10-09：修复R14-04首轮CI：`0e09d62` / [Windows CI37824900026](https://github.com/uniquenesssta/mdr/actions/runs/37824900026) 的取消22/22、全仓1724/1724、前端726/726、浏览器11/11＋37/37及真实WebView通过；安全写入专项17/18，测试Fixture仅用PID和时间戳，在同一Windows时钟刻度下目录重名（错误183），最终汇总正确阻断。测试目录新增原子序号与独占创建碰撞重试；原并发场景强制相同时间戳及已有目录，验证八个目录独立、已有内容保留和清理，仍保留八路实际写入完整性与18/18硬门禁。生产代码与工作流不变，四项静态门禁及文档/证据复核通过，待新Windows验证，R14-04不标验收，14.5未开始。[详情](docs/R14-04-DETAILS.md)。

- 2026-10-09：R14-03在 `751f012` / [Windows CI37818046855](https://github.com/uniquenesssta/mdr/actions/runs/37818046855) 七组及全部步骤通过，全仓1702/1702、前端704/704、任务16/16、请求31/31、导出基线41/41、浏览器11/11＋36/36，正式收尾。同分支实施14.4：任务/取消归入task目录，公开只读token实时消费唯一任务状态，可中断帧/库/增强/图片/对话框等待并拒绝晚到结果；文件写入、PNG编码与打印交接显式不可逆锁定，UI只发cancel。删除任意解锁和旧检查API，原解锁场景映射为结束锁定任务后取消新准备任务；补齐监听清理、晚到拒绝与实际按钮/pagehide回归。静态复核通过，待新Windows CI，14.4不标验收；F01/F02/F04与A10排期保持，已提交系统操作不能由token撤销。[14.3验收](docs/R14-03-DETAILS.md) · [14.4详情](docs/R14-04-DETAILS.md)。

- 2026-10-09：R14-02在 `b85f74c` / [Windows CI37807608820](https://github.com/uniquenesssta/mdr/actions/runs/37807608820) 七组与全部步骤通过，全仓1686/1686、前端688/688、请求31/31、导出基线41/41、浏览器11/11＋34/34，正式收尾。同分支实施14.3：公开控制器独占任务身份/进度/取消/阶段，删除classic权威状态；新任务替换旧可取消任务，锁定阶段拒绝替换，过时及销毁结果不能写进度/预览或完成新任务。补齐开关弹窗异常、晚到库/保存对话框/PNG和实际按钮/pagehide回归；静态复核通过，待新Windows CI，14.3不标验收。F01/F02/F04及A10排期不变，F03完整产物仍待后续格式验收。[14.2验收](docs/R14-02-DETAILS.md) · [14.3详情](docs/R14-03-DETAILS.md)。

- 2026-10-08：R14-01在 `7d0fd6a` / [Windows CI37801667677](https://github.com/uniquenesssta/mdr/actions/runs/37801667677) 七组及最终汇总通过：全仓1655/1655、前端657/657、导出夹具41/41、浏览器11/11＋33/33，正式收尾。继续同分支实施14.2：独立不可变Export Request统一格式/身份/名称/目录/图片选项，所有入口在任务前校验，异步准备固定参数；迁移重复后缀策略，保留旧夹具并记录新映射。补充真实入口无副作用与晚到改参回归；脚本/嵌入表达式和四项静态门禁通过，产品验证待新Windows CI，14.2不标验收，F01/F02/F04及A10保持接收排期。[14.1验收](docs/R14-01-DETAILS.md) · [14.2详情](docs/R14-02-DETAILS.md)。

- 2026-10-08：修正 R14-01 首轮累计回归遗漏：`734ca2c` / [Windows CI37799043386](https://github.com/uniquenesssta/mdr/actions/runs/37799043386) 的真实WebView、原生、依赖通过，浏览器11/11+33/33；Node/前端被14条旧R13自动分支断言和2条桌面Markdown名称夹具误判阻断，Rust契约检查及最终汇总随之失败。补齐唯一R14分支断言，分别记录桌面对话框首选名称与浏览器下载名称；保留全部场景和门禁。产品/依赖未改，静态复核通过；待新Windows CI，不标14.1验收。[详情](docs/R14-01-DETAILS.md)。

- 2026-10-08：13.14收尾提交 `4340398` / [Windows CI37792105001](https://github.com/uniquenesssta/mdr/actions/runs/37792105001) 七组及全部步骤通过。按用户指令建立唯一R14分支，实施14.1五种导出格式夹具：名称/目录/失败/取消、137块分批、打印恢复及PNG算法；真实built-app固定Markdown产物和其他四格式缺失退休预览变量的断链，另用锁定数学/Mermaid及真实PNG作能力正控。登记F01～F04及A10具体接收门槛；不把替身或缺陷基线通过写成实际导出修复。产品/模型/依赖/格式未改；四项静态门禁、语法/嵌入表达式、116个相对链接及35项风险源通过，产品回归复用七组Windows CI待验收。[详情](docs/R14-01-DETAILS.md)。

- 2026-10-08：13.14在 `9c62844` / [Windows CI37751356061](https://github.com/uniquenesssta/mdr/actions/runs/37751356061) 七组及最终同提交汇总通过并正式收尾：全仓1614/1614、前端616/616、浏览器11/11+29/29，实际剪藏DOM、翻译/图标、寿命与真实WebView导入链验收；原遗漏计数断言已闭环。仅登记文档和审计状态，13.1～13.14实现项全验收；A10的KaTeX/Mermaid两项low风险仍待阶段末处置，R13整体不标完成，未开始第14大阶段。[验收详情](docs/R13-14-DETAILS.md)。

- 2026-10-08：修复13.14首轮累计回归遗漏：`513b2cc` / [Windows CI37740940984](https://github.com/uniquenesssta/mdr/actions/runs/37740940984) 的实际剪藏弹窗、built-app浏览器、真实WebView、Rust/原生/依赖通过；图标与翻译契约仍只数旧模板，阻断Node/前端及最终汇总。改为旧模板+Import拥有的2个图标/10个绑定，保留47个图标引用与113个翻译绑定总量，补充实际DOM图标及全部文案/占位符语言切换验证；产品源码不变，待新Windows CI。[详情](docs/R13-14-DETAILS.md)。

- 2026-10-08：R13.13在 `5efe460` / [Windows CI37737197913](https://github.com/uniquenesssta/mdr/actions/runs/37737197913) 七组及同提交证据汇总通过，正式收尾并关闭A03/A05全链项、原R12-S01追踪号。开始13.14：删除四个未挂载网页ports、全局打开函数和内联modal，Import独占DOM/翻译/ModalShell及清理；迁移旧回归，补充实际菜单、焦点、关闭、晚到抓取、重复插入、构造回滚与销毁失败场景。待新Windows CI，13.14与R13整体不标完成，KaTeX新low风险保持。[13.13验收](docs/R13-13-DETAILS.md) · [13.14详情](docs/R13-14-DETAILS.md)。

- 2026-10-08：修复 R13.13 首轮累计回归遗漏：`92242e6` / [Windows CI 37660954894](https://github.com/uniquenesssta/mdr/actions/runs/37660954894) 的真实 WebView 导入链、Rust、原生与依赖四组通过；Node/前端因旧 classic 入口及固定事件数断言失败，汇总随之阻断。逐项迁移到当前 Import/Editor/Documents/Platform 契约，恢复执行 main 实际装配的 Platform 回归，保留原场景和硬门禁；产品源码不变，待新 Windows CI，不标验收、不推进13.14。[详情](docs/R13-13-DETAILS.md)。

- 2026-10-07：R13.13 完整导入链已迁入 ESM：文件、拖放、picker/recent/startup 共用公开 Import→Documents/Editor；保留先保存再读取、失败不建档、取消/代次保护及成功登记最近文件。删除文件/拖放桥接和经典建档入口，扩展真实 Windows WebView 抓取→转换→文档→Preview/Hybrid 八类证据门槛。前置补丁 `9279881` / [CI 37651965466](https://github.com/uniquenesssta/mdr/actions/runs/37651965466) 七组通过；本项待新 Windows CI，13.14及阶段收官未推进，KaTeX low新风险仍未处置。[详情](docs/R13-13-DETAILS.md)。

- 2026-10-08：R13.13 前置核查发现上轮收尾 CI 被新增 npm 高危公告阻断；定向更新 source-map-js 1.2.2 与 DOMPurify 3.4.16，本地锁文件审计无高危/严重项。补丁待 Windows 累计回归，导入到文档链尚未实施；保留现有硬门禁和两项 KaTeX/Mermaid low 告警。[详情](docs/R13-13-DETAILS.md)。

- 2026-10-07：R13.12 在 `fabf087` / [Windows CI 36971353716](https://github.com/uniquenesssta/mdr/actions/runs/36971353716) 七组及全部步骤通过，控制器/界面、会话取消与重复插入回归验收并收尾。R13.13 尚未开始，A03/A05 完整剪藏链路仍待联调。[详情](docs/R13-12-DETAILS.md)。

- 2026-10-02：修复13.12首轮CI：同步内联事件数量及Modal/Platform职责迁移断言；Windows浏览器清理遇到taskkill子进程竞争错误时，核实全部报错PID和根进程已退出后才允许通过，残留或不明错误继续失败。新增清理回归，生产代码不变，待Windows重验。[详情](docs/R13-12-DETAILS.md)。

- 2026-10-02：13.11 在 `fb019d4` / [Windows CI 36966040484](https://github.com/uniquenesssta/mdr/actions/runs/36966040484) 七组通过并收尾；开始13.12，剪藏输入/源内容/会话迁入控制器，界面迁入 Import，移除旧全局状态和内联按钮事件，新增生命周期及真实 DOM 回归，待 Windows CI。[详情](docs/R13-12-DETAILS.md)。

- 2026-10-02：13.10 在 `325e5cc` / [Windows CI 36903572172](https://github.com/uniquenesssta/mdr/actions/runs/36903572172) 七组通过并收尾；开始13.11，HTML→Markdown 与元信息组合迁入 Import，修正文字/地址转义、嵌套列表、代码围栏和表格输出，复用公共 URL 策略，新增固定夹具及 Preview/Hybrid HTML sink 回归。待 Windows CI，A05 未关闭。[详情](docs/R13-11-DETAILS.md)。

- 2026-10-02：修复 13.10 首轮 CI 的两项测试接线遗漏：S01 过期“13.9 未完成”断言改查已验收证据，文件/拖放源码浏览器测试补齐 DOMPurify import map。保留公共入口和原行为覆盖；生产代码不变，待 Windows 重验。[详情](docs/R13-10-DETAILS.md)。

- 2026-10-02：13.9 在 `52b28a0` / [Windows CI 36894947377](https://github.com/uniquenesssta/mdr/actions/runs/36894947377) 七组通过并收尾。开始 13.10：HTML 提取迁入 Import，惰性模板解析、正文选择和公共净化边界接通，新增浏览器无执行/无资源请求与端口寿命回归，待 Windows CI；13.11 未开始，A05 全链路未关闭。[详情](docs/R13-10-DETAILS.md)。

- 2026-10-02：R13-S01 后端专项在 `74abbd2` / [Windows CI 36890098604](https://github.com/uniquenesssta/mdr/actions/runs/36890098604) 七组通过并收尾；开始 13.9，将原生/浏览器代理/手动 HTML 协调迁入 Import，接通取消与过期结果拦截，错误和代理提示按纯文本展示。新增回归待 Windows CI；A05 全链路未提前关闭。[S01 验收](docs/R13-S01-DETAILS.md) · [13.9 实施](docs/R13-09-DETAILS.md)。

- 2026-10-02：修复 R13-S01 收尾因旧风险复核指纹过期而失败：复核当前抓取/取消链并更新当前指纹，保留 R12 历史验收快照及全部硬门禁。前轮六组 Windows 测试已通过，本次待精确提交重验，A05 全链路仍未关闭。[详情](docs/R13-S01-DETAILS.md)。

- 2026-10-01：R13-S01 重验 `ff2ed69` / CI 36877688203 的 Rust、前端、原生、WebView、依赖五组通过，根 Node 590/590；唯一直接失败为拖拽 E2E 启动 Chrome 后 CDP 持续拒绝连接，尚未执行拖拽断言。共享测试启动器现仅在未就绪、进程存活且清理成功的连接拒绝情况下恢复一次，以全新进程/端口/目录重启；每次仍限 30 秒，保留诊断，不重跑测试断言，连续失败仍阻断。新增恢复上限与错误保留回归，待 Windows 重验，底层 Chrome 卡住原因尚未确定。[详情](docs/R13-S01-DETAILS.md)。

- 2026-10-01：修正 R13-S01 首轮 CI 遗漏：TLS 用例误指向 src-tauri/tests 下不存在的证书，统一从 Cargo 根定位仓库共享夹具；Windows 旧字节冻结改为保留已批准 S01 用例，仅放行本次路径修正，HTTP/URL 硬门禁同步 17/10 项。四个 job 已通过；Rust 测试编译被该路径阻断，浏览器契约另有 CDP 启动超时（根因未知）。补启动进程/连接诊断与单次探测取消截止，不增加总等待、不跳过断言，待 Windows 重验。[详情](docs/R13-S01-DETAILS.md)。

- 2026-10-01：用户确认 R13-S01 网页策略并开始实施：10 MiB 原始/20 MiB 解压后上限、公网 HTTP(S)、HTML/XHTML、30 秒总截止与 10 次跳转、禁止 HTTPS 降级。后端逐跳解析并绑定连接地址、按实际字节读取和有界解压；新增原生取消配套命令及 AbortSignal 适配，旧 URL 调用与响应 DTO 保留。补真实 Windows HTTP/HTTPS、压缩/大小、私网/跳转与连接取消回归；历史 manifest 保留，新策略单独记录。仅本地静态检查，待七组 Windows CI；13.9 接入等待 R13-S01 验收。[详情](docs/R13-S01-DETAILS.md)。

- 2026-10-01：R13.8 正式收尾：`54fe195` 的 [Windows CI 36864276840](https://github.com/uniquenesssta/mdr/actions/runs/36864276840) 七个 job 全部成功；生产/测试代码保持首轮实现不变，旧启动超时根因仍未确定。开始 13.9 前置策略准备；R13-S01 的网页响应上限与内网支持规则待用户明确确认，后端加固未实施，13.9 尚未接入。[详情](docs/R13-08-DETAILS.md)。

- 2026-10-01：R13.8 首轮未验收：`12352d1` 的 Windows CI 36861368308 中，前端浏览器出现 CDP 未就绪与 app-ready 超时，收尾随之阻断；完整 Node、构建、架构、Rust、原生/WebView 和依赖检查通过。归档日志未包含启动页面诊断，不能确定根因；保持产品/测试实现不变，以本次失败记录触发新 runner 的完整重验，不把超时推定为工厂逻辑错误。[详情](docs/R13-08-DETAILS.md)。

- 2026-10-01：开始 R13.8：图片 Markdown 拼接从 Editor 图片命令迁入 Import 纯工厂，统一 alt/默认值、URL/Data URL 与既有右括号转义；图片命令保留选区归一化和单次替换事务。补纯函数、解析器与命令边界回归，严格保留原输出语义；复杂转义增强涉及冻结 Hybrid 解析器，单独记录未修复。本地静态检查通过，待 Windows CI。[详情](docs/R13-08-DETAILS.md)。

- 2026-10-01：R13.7 正式收尾：`081a16b` 的 [Windows CI 36858258580](https://github.com/uniquenesssta/mdr/actions/runs/36858258580) 七个 job 全部成功，图片读取/取消与累计回归通过，具备 13.8 准入条件。[详情](docs/R13-07-DETAILS.md)。

- 2026-10-01：开始 R13.7：图片 File/Windows 读取迁入可取消 Image Import Controller，URL/上传生成显式插入请求；移除 events/dialog 的 FileReader 实现。拖放代次传递取消信号，对话框换图/关闭/销毁清除旧状态，晚到结果不能复活或插入。补独立生命周期、实际 Platform 与真实浏览器读取回归；本地仅静态检查，待 Windows CI。[详情](docs/R13-07-DETAILS.md)。

- 2026-10-01：R13.6 正式收尾：`073c59b` 的 [Windows CI 36855278836](https://github.com/uniquenesssta/mdr/actions/runs/36855278836) 七个 job 全部成功，图片策略与累计回归通过，具备 13.7 准入条件。[详情](docs/R13-06-DETAILS.md)。

- 2026-10-01：开始 R13.6：浏览器图片 MIME、5 MiB 硬限制及对话框超过 2 MiB 确认集中到纯 Image Policy，分类器/拖放/对话框共用；保留 Windows readImage 20 MiB 与 dropped-file 5 MiB 的 Rust 权威。新增独立边界与端口销毁回归，原入口行为矩阵保留；本地仅静态检查，待 Windows CI。[详情](docs/R13-06-DETAILS.md)。

- 2026-10-01：R13.5 正式收尾：`fd9c35d` 的 [Windows CI 36853092080](https://github.com/uniquenesssta/mdr/actions/runs/36853092080) 七个 job 全部成功，Drop Overlay 与累计回归通过，具备 13.6 准入条件。[详情](docs/R13-05-DETAILS.md)。

- 2026-10-01：开始 R13.5：遮罩 DOM 显示迁入纯 Drop Overlay View，移除 events 渲染逻辑；显示时机仍由 Drop Import 决定，销毁隐藏并释放引用，晚到显示无效。现有 Platform 初始化与真实 DOM 拖放回归接入新 View，待 Windows CI。[详情](docs/R13-05-DETAILS.md)。

- 2026-10-01：R13.4 正式收尾：`cd85861` 的 [Windows CI 36849373596](https://github.com/uniquenesssta/mdr/actions/runs/36849373596) 七个 job 全部成功，完整应用启动恢复，具备 13.5 准入条件。[详情](docs/R13-04-DETAILS.md)。

- 2026-10-01：修正 R13.4 启动阻断：main 误把经典端口的 supports 方法用于原始 Platform，现读取正式 capabilities 字段；补充执行真实 main 组合代码的浏览器/桌面 Platform 回归。两条最近文件旧断言同步加入代次条件，并补过时成功不登记行为测试。首轮根 Node 563/563、独立浏览器 E2E 10/10 通过，但完整应用启动失败；修正待 Windows 重验。[详情](docs/R13-04-DETAILS.md)。

- 2026-10-01：开始 R13.4：迁移浏览器/Windows 拖放计数、遮罩状态与首项分类路由，删除旧分类桥；补充监听解绑、晚到订阅释放及过时文本/图片结果保护。原类型、大小与最近文件行为保留，新增真实 DOM 拖放回归，待 Windows CI。[详情](docs/R13-04-DETAILS.md)。

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
