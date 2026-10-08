# R13.14 删除旧导入实现

状态：**实现与回归迁移已完成，待本提交 Windows 验收**。2026-10-08用户要求“收尾13开始14”，承接13.13并开始13.14；不启动第14大阶段。唯一分支 `agent/r13-stage`，基线 `5efe460b6025b5af0de25ee917fa6dccd542c50d` / [Windows CI37737197913](https://github.com/uniquenesssta/mdr/actions/runs/37737197913)。前置七组与精确提交汇总全部成功，13.13、A03/A05完整链及原R12-S01追踪号已关闭，见 [13.13正式验收](R13-13-DETAILS.md)。

## 责任与删除边界

删除四个未挂载的 `classic-web-fetch-port.js`、`classic-html-extractor-port.js`、`classic-html-markdown-port.js`、`classic-web-clipper-port.js` 及Import公共导出。File/Drop ports已在13.13删除，本项复核其调用者未回流。公开Import入口只导出实际读源、协调、策略、转换和视图能力。

`public/app/web-clipper.js` 移除 `openUrlModal`、Document UI port获取和校验；保留仍实际使用的Find/Preview回调及Toast，不删除这些尚未迁移的责任。events仅通过公开Document UI命令发起文件选择，editor-tools没有导入实现；本项未改无关键盘和布局逻辑。

`business-content.html` 删除网页菜单的内联打开handler和整个url-modal模板。菜单既有 `import.web` 命令直接调用组合根注册的公开 `openWebClipper`。通用兼容ModalShell注册表不再管理url-modal，剩余六个弹窗继续原生命周期与回归。

## Import拥有弹窗与生命周期

`createWebClipperView({overlayRoot, controller, translate, notify, subscribeLocale})` 取代外部模板root。它通过现有安全DOM构造器创建固定元素，沿用原控件ID、类和翻译键；源HTML仍仅由控制器持有。没有innerHTML模板或新业务全局。

- View拥有创建的DOM、ModalShell、输入/按钮监听、控制器状态订阅和语言订阅。页面初始化后新建的控件由独立语言订阅刷新，避免静态bootstrap翻译绑定遗漏动态弹窗。
- 打开幂等，重复命令保留当前会话；初始焦点在URL输入，Tab限制在弹窗，Escape、遮罩、取消和插入关闭进入同一控制器取消路径。关闭后返回触发前焦点。
- 重复挂载在接触新控制器前拒绝。构造失败回滚已经取得的资源；destroy幂等且终止，逐项尝试退订、事件清理、ModalShell/控制器销毁和DOM移除，即使一个disposer失败也继续释放，其错误汇总抛出。
- 被销毁的旧View不能删除后续新View的DOM；晚到请求、死DOM上的输入和按钮不能写入文档。

组合根提供现有I18n公开订阅、平台抓取协调器、提取/转换与Import→Editor事务。pagehide、功能销毁和启动异常继续使用既有Import幂等释放路径。没有新增第三方/系统接口，复用既有UI原语；Mermaid Chart已按真实菜单、弹窗、抓取、插入与销毁链更新架构图。

## 旧断言迁移对应

| 原测试目的 | 新接口或行为 | 保留场景 |
| --- | --- | --- |
| classic extraction/conversion ports透传结果与错误 | 公开Clipper Controller的注入提取/转换与插入 | 对象identity、转换失败不插入、错误后重试、重开清源、销毁终止；提取/转换固定夹具不变 |
| classic Fetch port输入监听与过时请求 | 公开控制器输入取消；实际View输入和destroy | 输入修改取消、关/重开拒绝迟到HTML、退订不再通知、死DOM事件无效、平台cancel IPC错误可观察 |
| classic Clipper port唯一挂载与寿命 | View实际DOM所有权与Controller会话 | 重复挂载拒绝、幂等打开/销毁、后继View不受旧destroy影响、构造回滚、disposer错误继续释放 |
| 全局菜单打开函数到唯一Editor模型 | Menu `import.web`→公开Document UI→View/Controller→Import→Editor | 真实Windows WebView从菜单点击抓取，明确检查无global/onclick；八类链证据、单次替换/追加及原安全门禁保持 |
| 兼容modal统一焦点与关闭 | 六个兼容modal原回归；剪藏独立ModalShell | URL初始焦点、Tab包围、Escape/遮罩关闭、返回焦点、语言刷新、错误纯文本、重复插入仅一次 |
| R12移交不误标修复 | 原未勾选/未修复断言保留，仅测试名称明确历史快照；当前追踪号另登记13.13验收 | 四个文档契约与历史汇总全部原断言保持，后续关闭不回写R12事实 |
| Platform及Stage1精确迁移表 | 当前实际接线、清单与33个inline事件 | 历史67/9/38不变、经典脚本六项不变、business global写入集合不增加、删除项不得回流 |

不跳过用例、不忽略失败、不放宽抓取/安全/汇总门禁。测试中已删除port的接线断言移动到公开接口和真实View；历史R12夹具、已归档验收与模型冻结指纹保持。

## 静态与Windows准入

生产模块清单精确移除四个已删除文件，修订现存View与经典Find/Preview文件责任。架构baseline仅删除一条已迁移inline handler并更新位置，保留R12-18 scanner修正说明。当前风险源指纹跟随实际代码，历史acceptance和内嵌R12指纹不回写；R12移交语义与R13后续关闭分开记录。

本地语法、架构、无旧运行入口、生成文件、README记录、文档链接、35项当前风险源及4项已删除源的追溯blob和差异静态检查通过；不执行Linux/macOS产品测试或构建。全部行为、浏览器、实际Windows WebView、生产构建、Rust/原生与同提交累计验收由新Windows CI执行。13.14复选框保持未完成，待七组及其证据全部通过再收尾。推送启动后结束会话，不轮询；约15～20分钟后查询。

KaTeX 0.16.47 / Mermaid传递low公告及A10阶段末复核仍未处置，不将13.13的完整链成功扩大为该公告修复，也不宣称R13整体完成；详见 [13.13安全复核边界](R13-13-DETAILS.md)。没有依赖、Rust命令、模型算法或存储格式变化；回退本项可恢复13.13调用链，无数据迁移。
