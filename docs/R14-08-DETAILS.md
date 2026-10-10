# R14-08 Export Styles

状态：**已实施，待本提交 Windows 七组累计验证与实际 PNG 核对**；14.8不勾选，14.9未开始。继续 `agent/r14-stage`，基线为07正式验收提交 `c532cd1aaf4995cf01a25243f89addb5d1cf87df` / [CI38021008368](https://github.com/uniquenesssta/mdr/actions/runs/38021008368)。

## 07收尾与本项范围

07精确head、七个job及全部执行步骤通过：全仓1815/1815（332文件16目录）、前端810/810、安全6/6、增强27/27、Builder21/21、导出/请求/任务/取消/进度43/31/16/22/20、Settings5/5、浏览器11/11＋42/42、Rust281项与真实Windows导入链8/8。前端、全仓和最终汇总三个归档摘要一致，正式证据、首轮失败及测试修复均见 [07详情](R14-07-DETAILS.md)。KaTeX兼容补丁通过，A10最终完整离线格式门槛保持。

此前已接收的PNG公式额外x2/21在成功CI产物中仍存在。源码没有显式加载完整KaTeX CSS，只有自有display间距/font-size规则；锁定0.18.2的[官方样式源码](https://github.com/KaTeX/KaTeX/blob/v0.18.2/src/styles/katex.scss)规定辅助MathML为absolute、1px、clip-path inset(50%)、overflow hidden。[官方问题说明](https://katex.org/docs/issues)把辅助内容可见作为缺失CSS的诊断。完整锁定样式缺失已在静态链路确认；原PNG不能仅凭解码/节点数量宣称视觉正确，修复效果仍须本提交Windows像素与图片证据。

本项完整迁移文档内容样式：HTML/Word重复模板、打印内容规则及Image稳定颜色/排版。图片比例/高度、资产预载、离线字体封装、格式文件写入、打印隔离计时器和全部暂存节点释放仍按后续任务职责实施。

## 唯一样式所有者与所有调用者

新增 `src/features/export/document/export-style-sheet.js`，由公共Export入口导出 `createExportStyleSheet`；经典调用者只消费作用域 `classic-export-style-port.js` 的冻结 `getCss(format)` 和 `apply(root, format)`。main创建唯一owner并注入可信锁定CSS资产，不读取用户文档或动态拼接用户CSS。

文档正文、标题/段落、代码与行号/token、任务列表、表格、引用、图片、标准SVG及数学规则集中维护；格式profile仅保留真实差异：HTML宽度/边距、Word12pt与标题点单位、打印纸面/分页、Image主题。Word文本CSS将本地颜色变量解析为字面值，并使用普通行布局，不要求Office支持CSS变量或Grid。

| 原职责 | 新公共调用 | 生命周期与边界 |
| --- | --- | --- |
| HTML内嵌CSS | `getCss('html')`，body绑定公共类/profile | 纯文本，无活DOM副作用；旧CDN与独立脚本由14.10接收 |
| Word内嵌CSS | `getCss('word')`，body绑定公共类/profile | 与HTML共用内容规则；本项不宣称真实Office完整格式通过 |
| PDF内容打印样式 | 增强正文挂载前`apply(body,'pdf')` | afterprint/原fallback及异常释放；壳几何继续由export.css负责 |
| Image稳定排版/颜色 | `apply(clone,'image')`贯穿增强、准备与编码 | success/error/cancel finally释放；高度/裁切清理保留原场景 |
| Preview/Hybrid数学 | main显式导入锁定`katex/dist/katex.css`，在应用样式之前 | Vite打包字体路径；既有应用间距/字体覆盖保持，无导出类污染 |

main另以Vite `?raw`取得同一上游CSS文本供文档序列化，保留原始数学布局规则，仅去除相对字体URL的`@font-face`，避免导出文件产生错误的fonts相对路径；字体可携带封装仍由14.10/14.11负责。未复制或人工翻译整个KaTeX布局，也未更新任何依赖/锁包。

## 作用域与释放

只在`.export-document`及经过校验的format下生效，Preview/Hybrid根不添加导出类。HTML/Word/PDF保留官方可访问MathML裁剪；PNG没有可访问树，仅在Image作用域设置辅助MathML display:none，不删除源DOM或换用另一套数学渲染器。Image颜色与代码token消费既有主题令牌。

owner惰性挂载一个活style节点并管理每个根的lease。release恢复原类/format；同根替换先释放旧lease，迟到旧release不能清掉新profile；不同根独立释放。destroy幂等恢复所有活根并移除自身节点，拒绝迟到get/apply。输入format/根/所属文档检查在挂载前执行；样式节点挂载失败保持根原状并允许重试。桥接卸载只撤销端口，不销毁owner或替代宿主属性。

pagehide逐项释放任务、增强器/Builder、进度与样式owner/端口，一项既有清理异常不阻止其他释放。原PDF80ms交接与1200ms恢复计时器仍由14.12接收，原Image暂存正文仍保留至下次替换/14.16完整释放；本项只解除样式作用域，没有把后续资源职责标为完成。

## 契约映射与 Windows 证据门槛

新增21项公共样式及真实经典调用链契约：四profile内容/数学规则、锁定布局完整性、可访问裁剪与Raster-only隐藏、非法/外国根、注入失败重试、单节点/多根/同根替换、恢复/幂等销毁、冻结端口/替代宿主保护、两格式实际CSS序列化、PDF afterprint/fallback、Image成功/失败/取消释放。

原43/31/16/22/20、Builder21、增强27、安全6及Settings5场景保留。VM新增接入真实Style owner；DOM/vendor替身只证明编排，不用它们证明字体、SVG、PNG或系统打印。原格式夹具、名称夹具与冻结模型/存储保持。

原42个built-app场景保留，新增三项为45：

1. 捕获实际HTML/Word文件，在去除script/link后的独立iframe验证其自身CSS：两个公式与MathML裁剪、图表、代码行、任务列表、表格、字号。iframe无应用CSS和脚本，不表示离线字体/原独立脚本已完成。
2. 浅/深色均走实际Image出口和锁定dom-to-image-more3.10.0；解码实际PNG，与同一正文移除全部MathML后的参考PNG逐像素比较，必须零差异；可见x2/21文本正对照必须改变像素。归档实际/参考PNG与差异JSON，不用“有两个KaTeX节点”代替视觉验收。
3. Preview/Hybrid真实数学节点在导出作用域挂载与释放前/中/后保持连接、相同计算样式和可访问裁剪，视觉HTML不能被隐藏。最终pagehide场景追加活lease、style节点和端口释放断言。

原18个实际文本产物、完整长文/Worker资源、取消/失效/销毁、真实打印交接/PNG及文件边界均保留。CSS测试原“index.css必须位于main第一行”映射为唯一应用入口、唯一锁定vendor CSS及vendor先于应用覆盖的顺序断言；原全局语义token检查追加仅限本owner且实际声明的`--export-*`局部令牌，其他文件未知令牌仍失败。

## 静态复核与待验限制

本地仅执行架构/退休运行时/生成文件/README四项静态门禁，以及脚本/嵌入表达式语法、JSON/YAML、链接、源指纹、冻结/夹具/历史保持与diff检查；四项门禁通过；9个脚本、19个实际页面嵌入表达式与5段样式语法通过；JSON/YAML、118个相对链接、52项风险源指纹、9个冻结文件及24个保留文件字节与旧验收/失败历史保持核对通过。未运行本地产品Node测试、浏览器、构建或Rust。产品测试与真实图片结果只由本提交Windows CI决定，14.8尚未验收。

Context7已核对KaTeX双输出/样式职责与Vite7导入文本/字体重定位，并结合锁定KaTeX0.18.2源码与Vite7.3.6本地解析实现核对；Mermaid Chart已显示实际中文共享样式、四格式、Preview/Hybrid及释放链。CI新增export-styles.log，保留原七组与全部累计门禁。启动后结束会话，不轮询，约15～20分钟后查询。

F02旧HTML CDN/应用内变量引用、离线字体、14.12打印隔离和14.16图片完整资源释放保持接收；独立Editor指标错误继续开放。07验收、R12历史公告/交接以及所有失败/修复事实均不重写。
