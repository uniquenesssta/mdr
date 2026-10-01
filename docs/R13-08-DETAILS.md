# R13.8 Image Markdown Factory

状态：实现已提交，**待精确提交 Windows CI，未验收**。唯一分支 `agent/r13-stage`；前置与回退代码基线 R13.7 `081a16bf79a85401b8fa1390d24b5fa46af472ef`，Windows CI 36858258580 七个 job 全部成功。

## 实际变更与范围

新增 `images/image-markdown-factory.js`，由 Import 公共入口导出纯函数 createImageMarkdown(url, options)。它唯一负责图片 Markdown 字符串：URL 转字符串后去两端空白、空 URL 抛出原 TypeError；fallbackAlt 默认“图片”，alt 保持原有 falsy 回退与字符串转换，右方括号仍按原规则反斜杠转义。URL/Data URL 的内部字节、查询参数、已有百分号编码和路径语义均不改写。

Editor image-command 经 Import 公共入口调用工厂，删除原归一化/默认 alt/转义/拼接；仍负责选区归一化、传入选区优先、一次 replaceRange 和原返回值/异常传递。现有 Image Dialog/Drop → Editor Command Service → Image Command 路径自然共用同一工厂，无新增兼容桥、全局对象或控制器状态。

工厂不做文件读取、DOM 操作、网络请求、URL 解析或协议安全判断；没有需要销毁的资源。R13.7 图片读取与取消、现有渲染净化和持久化格式不变。生产清单追加一个纯函数模块。

## 兼容性限制与交接

本项是现有序列化职责的提取，并非改变 Markdown 方言或新增输入净化规则。既有复杂 alt（反斜杠与括号组合、嵌套语法）及含空格/不配对括号的原始地址，不宣称全部可以正确渲染。

检查发现冻结模型 `src/editor/hybrid/block-registry.js` 对 alt 使用简化的闭括号提取，并对 URL 只移除外层包装；直接加强反斜杠转义或改写 URL 会导致 Preview/Hybrid 或原生路径解释不一致。因此没有把额外转义增强混入本次提取，也没有修改冻结算法或门禁。该既有限制未修复；如后续需要完整增强，必须先单独处理模型冻结约束并验证两种渲染与原生路径的同一语义。不能以本次工厂单测代替这项验收。

## 验证

- 独立工厂测试覆盖普通 URL、PNG/SVG Data URL、blob/asset、中文/emoji、多个右方括号、alt/fallback 的既有转换和空 URL 错误。
- URL 内部字节和不可变输入契约，固定原有输出，防止重构暗中改变地址或百分号编码。
- 使用项目锁定 Marked 16.4.2 的 Lexer.lexInline 验证已支持输出形成单个 image，URL 不变且不产生 title；不把已知复杂边界误标为支持。
- 真实 Image Command 验证单次替换、显式选区、选区归一化、失败前不读选区/不提交事务、适配器错误原样传递；原 Stage 5 图片行为测试保留。
- 静态检查确保命令只调用公共工厂、无第二份拼接，工厂没有 DOM/读取/编辑器副作用。

本地仅执行 JS/MJS 语法、JSON/导入与差异检查，不在 Linux/macOS 运行产品测试或构建。完整行为、架构、Windows WebView、浏览器、Rust 与依赖回归交由现有七组 Windows CI；启动后停止，不轮询，成功前不勾选 13.8。

已用 Context7 核对 Marked 测试 API，并用 16.4.2 官方源码校核版本差异；未升级依赖。Mermaid Chart 已复核入口与单次编辑事务。A05 的 R13-S01 仍须先于 13.9 完成；本次未开始网页抓取或修改其限制。

## 首轮 CI 与重验（2026-10-01）

`12352d1992b13d21fab7ec9dba58228e745a1fe5` / [CI 36861368308](https://github.com/uniquenesssta/mdr/actions/runs/36861368308) 为 5 个 job 成功、前端与依赖前端的收尾 job 失败。前端 Node、架构、构建已通过；Browser preview contract 在 Chromium CDP 建连阶段报 `CDP endpoint did not become ready: fetch failed`，Built-app browser regression 报 `Timed out waiting for application ready`。完整仓库 Node、Rust、原生边界、实际 Windows WebView 和依赖检查均通过。

已读取前端与收尾日志及前端产物 ZIP；产物只保存了上述超时日志，没有初始化页面异常详情，因此不能断言两个超时同根或已经定位产品缺陷。本次只补失败事实并触发全量新 runner 重验，不改生产代码、不改等待阈值、不增加重试掩盖断言，也不改冻结模型。完整重跑是为了保留收尾要求的同一运行轮次七组产物；只重跑失败 job 会缺少本轮其他 job 产物。R13.8 保持未验收，复杂转义限制保持原记录。
