# R16-02 经典脚本清除

2026-10-23用户授权“已通过 收尾 推进02”。R16-01已在733c2ae / CI39960541384精确验收，收尾基线b88a94e，继续唯一codex/r16-stage。范围为16.2及完整受影响链路，16.3未实施。

## 实施与职责

删除public/app/五个经典脚本及main动态脚本加载器，生产入口仅ESM。既有Document Controller、Settings Store、LayoutState、Preview和Persistence保持权威；迁移的是尚存的命令接线、UI投影及启动顺序，冻结内核、Rust、持久化格式和依赖不变。

| 退役文件 | 当前所有者与保留断言意图 |
| --- | --- |
| core.js | documents/ui/document-workspace.js：文档生命周期及索引缓存；persistence/ui/workspace-status.js：保存状态/语言/预览策略投影；menu/shell-menus.js：菜单/Toast；layout/workspace-preferences.js：设置投影与布局命令 |
| bootstrap.js | bootstrap/workspace-startup.js：恢复偏好→空会话→Preview/布局→Help/语言→初始路径；直接返回可等待结果 |
| editor-tools.js | layout/workspace-preferences.js：同一Settings Store读取偏好；布局/可视编辑命令显式注册；已迁移全屏直接现有Controller |
| events.js | bootstrap/application-events.js：事务/快捷键/菜单事件；输入从已删除metrics函数改为现有geometry命令 |
| web-clipper.js | editor/application/find-preview-commands.js：原生Find先保存、检查身份/版本再搜索，预览定位可销毁；Toast由Menu所有者维护 |

所有者显式注入能力，不再查DOM兼容宿主获取依赖，也不通过共享词法环境或window初始化Promise相互依赖。application-lifetime管理独立注册、监听及定时器，部分构造失败回滚；销毁继续尝试全部释放。菜单按钮、侧栏隐藏绑定与E2E/Windows就绪检测属于此次切换必需的调用者迁移，视觉与交互保持，未扩大为16.4完整模板清理。

## 测试迁移映射

保留此前各阶段行为测试。tests/support/application-surface-source.mjs将原经典文件的断言意图映射到当前所有者源文件，缺失直接失败，不回退历史源码。仅对明确退役的共享变量声明、函数包装、经典语法与全局入口断言更新为当前ESM/Settings权威/公共命令验证；113翻译、SVG、模型字节、包体、导出和原生大文档场景保持。R15冻结事件目录仍保留43源及原始SHA，移动生产者明确映射到其历史来源。新增12项ESM/输入/保存搜索/销毁/启动顺序及失败契约。

## 验证与待验收

验证进行中；本地首轮迁移回归暴露端口挂载句柄误注入、旧全局调用及旧路径断言，均记录为未通过结果，修复后须完整复验。不得凭构建通过收尾。待本地适用门禁及同提交Windows七组CI；推送后停止轮询，等待用户通知。


## 本地验证证据（2026-10-23）

- 最终全仓跟踪测试：360文件、16目录，2720/2720；无跳过、取消或失败。新增ESM专项12/12，原浏览器契约11/11，四项架构/旧运行时/生成文件/README门禁通过。
- 生产构建通过；主包685.46KB，workspace-shell及E2E依赖闭合集合独立打包，原500000/700000字节预算不变。入口和模块清单为567个实际生产文件；10项受保护模型源哈希保持，Rust/依赖/锁文件无改动。
- 原文件O:/Project/Markdown Rust/500万字.md：5453875字符；同量级夹具5390000字符。两者各通过真实Windows IPC打开、Tauri拖放事件、浏览器File输入、切换后原生正文重开，共8条。每条正文长度/SHA一致、可见编辑正文、nativeBacked、metadata无正文副本、session小于32KB；控制台错误和异常均为0。证据位于本机Temp/mdr-r1602-native-90pNdP/verification.json。原文件只读；拖放使用真实Tauri事件传输，并非OS物理拖拽。
- 删除清单重新冻结1127个跟踪输入：104候选中37已缺席、59仍引用、6受保护、2未证明；全部deletionAllowed=false。已删除的五个经典文件均有明确所有者和行为覆盖映射，其他候选没有因此获准删除。当前159项风险源指纹核对；历史R12/R15/R16-01验收、Stage1审计纠正和旧SHA保留。
- 迁移中发现并修复端口mount/API误注入、剩余HTML按钮/测试全局调用，以及对话框能力过早绑定导致实际prompt无法被场景替换的问题。Find使用真实saveActive参数并等待保存，文档/版本改变或销毁后不搜索/不提交选区。首次失败记录保留，不通过延长超时或降低断言处理。

最终前端产物的75项完整实际页面全部通过，新增断言确认页面脚本全部为ESM且没有/app/脚本。用户原文及同量级夹具的8条原生链路也在最终前端重跑通过，证据为Temp/mdr-r1602-native-90pNdP/verification.json；控制台错误/异常为0。R16-02尚未正式验收，下一步为精确实现提交的Windows累计CI。推送后不轮询。


## 最终实际页面的端口故障与修复

当前产物的一轮75项验证为74通过/1失败：默认生产页在进入场景前，系统分配CDP端口6679；Edge已输出DevTools监听成功，但Node Fetch以cause=bad port拒绝连接。已核对本机Node内置Undici的精确禁止端口表，CDP只排除该集合，每个探测socket均先关闭；32次仍失败则明确报错。保留普通低端口，未增加浏览器启动重试、延长超时或放宽任何断言。新增3项回归覆盖6679/10080拒绝与6680正控、有限失败和实际HTTP Fetch/JSON就绪；CDP专项共12/12通过。修复后完整75/75页面通过。此处没有将R16-01旧的ECONNREFUSED启动失败追认为同一原因。

最终当前构建来源校验accepted=true：508源码输入、137输出，sourceSha256为2cb8966573368ba5dfa9ba10f9b6c17dfc7bd3b10c5f0af4f5936e3eaf52a97c。public/app/在源树和本机构建输出中均已移除；没有批量递归删除。端口修复后最终全仓2720/2720通过，无跳过、取消或失败。


## 最终交付记录

本次已实现，等待实现提交的精确Windows累计CI，R16-02未提前勾选验收，R16-03未开始。全仓2720/2720（360文件/16目录），ESM专项12/12、CDP专项12/12（新增3项），原浏览器契约11/11＋当前生产包75/75；四项架构门禁、159项源码指纹、冻结清单CLI、来源指纹和diff空白检查通过。源码/输出均不存在public/app目录。原生8链在现有调试Tauri二进制＋最终Vite源码、独立WebView配置下复验；真正嵌入生产bundle的同提交Windows验收仍由CI完成。原文件只读，验证服务仅按已核验PID关闭。

最终移除空目录后，两项旧的CodeMirror/Theme扫描仍枚举public/app而失败；现分别扫描所有public源码与当前完整生产JS集合，原职责禁止条件保留并扩大覆盖。相关63/63通过，随后最终全仓2720/2720通过，不保留空目录来掩盖旧断言。此前失败记录和所有历史验收保留。回退使用本次实现提交的git revert，阶段前收尾基线b88a94e；不重置用户AGENTS.md修改，不递归清理用户文件。


## 正式验收（2026-10-23）

实现提交0963dfe4ee1dd9b29053b8982489e04a6645f93f的[CI39971556914](https://github.com/uniquenesssta/mdr/actions/runs/39971556914)七组Windows及全部步骤成功。closeout-verification.json的accepted=true、commit及run均精确匹配；WebView原生大文档四路正文长度/SHA、nativeBacked、metadata无正文副本和有界会话通过。Node2720、ESM12、CDP12、浏览器11＋75、Rust299和删除清单13通过，R16-02正式收尾。历史失败及本地调试二进制验证边界保留。

归档12509921802（closeout，8081字节）SHA256=ad78bc7a66fdb672aece5470a84ba537173c74c6ee6e44c2d66c3daf4167932a；12510001649（WebView，1344255字节）SHA256=d73196b534dec58d2efe73bd3bf74645389fa94441c271e736d0780130ff0d35，均下载核验一致。首次gh下载连接被远端关闭，连接器转存下载成功，没有用未取得产物替代验收。

按用户“收尾02开始03”，继续唯一codex/r16-stage实施16.3；16.4及后续未授权。推送后停止CI轮询。
