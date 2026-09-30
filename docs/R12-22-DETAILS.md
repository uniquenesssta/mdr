# R12-22 当前 HTML 渲染安全边界整改（A03）

状态：基线提交 `631adcb9106e1e9b5031e4d91a84db0f5cb55bdc` 的 [Windows Actions 36704905753](https://github.com/uniquenesssta/mdr/actions/runs/36704905753) 已全绿，5/5 job、全仓 Node 1472/1472、Rust 268/268、架构/Clippy/构建通过。真实 WebView 四面均确认事件执行与测试自有文件原生 IPC 访问；没有 CSP。R18-N01 已通过 Windows 架构复验。本轮根据证据实施公共净化与 CSP，修复后 Windows 验收待 CI；A03 仍开放、12.22 不勾选，12.23 未开始。分支仅 `agent/r12-stage`。

## 顺序与当前范围

任务书 12.22 明确要求“先在真实 Windows WebView 用无害标记确认 raw HTML 的事件属性、危险 URL/嵌入元素及 CSP/IPC 边界”。因此先提交可复核的原生探测，不在观察结果出现前宣称已修复或已排除 A03。用户要求启动 GitHub Actions 后立即结束会话，不轮询；基线已查询并读取原生 JSON，本批按真实结果实施公共净化/CSP，并提交修复后安全与合法内容回归。12.23 尚未开始。

整改前静态事实：Preview 的 `patchHtml` 及默认 Block View 解析、Hybrid 的 `renderHtmlBlockSource` 都把原始 HTML 经 template 插入主 DOM；`security.csp` 为 null。`withGlobalTauri:false` 没有证明内部 IPC 不可达。历史 HTML 显示契约在本轮明确改为安全 DOM；原始 Markdown 源码不改写，不再承诺执行原始 HTML。对应测试按本阶段安全要求更新，未跳过或删除门禁。

## 原生探测链路与证据

累计入口仍是 `.github/workflows/r12-14.yml`，全部已有 Node、Rust、架构、依赖、构建、浏览器、Clippy 和 native opener 门禁保留。新增独立 `webview-baseline` job，Windows 2025、精确 event SHA、Node 22、Rust 1.88.0，使用现有嵌入 WebDriver 方案运行真实 Tauri Windows 应用。

`prepare-embedded-driver-host.ps1 -PreserveProductionLock` 只在仓库外的隔离副本加入 WebDriver plugin、权限并移除 devUrl；前端 dist、生产命令、CSP 与全局 Tauri 配置保持。该选项从既有 Cargo.lock 解析新增测试依赖，逐项检查所有生产 registry package 的 name/version/source/checksum 均仍在 host 锁文件中；不能为了使探测 host 编译而悄悄升级生产依赖。隔离 host 使用 `cargo build --locked`；生产 manifest/lock/config/main/capabilities 不写入 WebDriver 依赖。驱动保留现有应用初始化及正常帮助弹窗关闭屏障。

| 观察面 | 真实应用入口 |
|---|---|
| Preview Markdown 管线 | 现有 editor `loadDocument`、正常 input 事件、Preview Command update |
| Preview 整体 HTML | 现有 scoped PreviewRendererPort.patchHtml |
| Preview Block HTML | 现有 scoped PreviewRendererPort.patchBlocks，真实默认 Block View |
| Hybrid HTML Widget | 现有布局命令切换 hybrid、editor 装载 Markdown、真实 HTML widget |

每面记录无害文字控制、事件属性是否保留、img error/button click/SVG load 标记、javascript URL 的保留及点击标记、srcdoc 脚本标记、object/embed/style 的保留、固定 loopback 图片/CSS 标记请求、真实 CSP response/meta 与 violation 事件。

IPC 只调用既有 `read_dropped_file` 读取本测试在 RUNNER_TEMP 新建的 canary.md；先用测试驱动调用作正常控制，再由 raw HTML 的 img error handler 尝试相同命令与相同 canary。结果只记录是否调用、是否成功和返回值是否等于固定无害文字，不读取用户文件，不测试写入/删除/外链命令。标记服务器只绑定 127.0.0.1，仅接受固定标记路径，记录夹具标识，不收集 cookies、headers、正文或秘密。所有 canary 文件在 finally 中删除。

`render-boundary-baseline.json`、四面截图、启动/构建/探测日志、SHA、host 元数据和隔离锁文件通过 `r12-22-webview-baseline-<SHA>-<attempt>` 上传，即使失败也保留。基础设施或挂载失败导致 job 失败；观察到风险不会被改称安全通过。一次没有 marker、1 秒观察窗口内 IPC 未返回或 CSP 拦截某个样例，都不能排除其他攻击面。当前 schema 固定 `acceptedSecurityBoundary:false`。

## R18-N01 循环依赖修复

`VirtualPreviewController` 改为直接导入职责明确的 `preview-thresholds.js` 和 `virtual-window-controller.js`，不再回引自身所属公共 `index.js`。继承、阈值来源、公共导出与生命周期保持。新增回归固定此依赖方向；原全仓架构图/循环检测保持，提交 `631adcb` 已通过实际 Windows 架构门禁，R18-N01 已复验解决。

## 验证状态与后续验收

提交 `f5a9ce7110ddcc3774ad5c6e42c5e9eae79042e9` 的 [Actions 36695958389](https://github.com/uniquenesssta/mdr/actions/runs/36695958389) 在解析阶段失败：第 495 行 job 级 env 使用 `${{ runner.temp }}`，报 `Unrecognized named-value: runner`；0 个 job、0 个 artifact。因此原生探测及所有产品测试均未执行，R18-N01 也没有取得 Windows 复验证据。

修正只涉及 CI 配置、回归及记录：移除 job 级 runner 表达式，在初始化运行步骤通过 `printf` 将 RUNNER_TEMP 下的日志目录写入 GITHUB_ENV，供后续原生应用启动使用。原探测内容、隔离 host、生产渲染、CSP、依赖及全部累计门禁保持。新增 Node 回归扫描本工作流全部 job env，拒绝不可用的 runner/steps/job/env 上下文，并验证目录在原生启动前已导出。

官方 actionlint 1.7.12 静态检查已复现修正前错误，修正后整个 R12 工作流语义检查通过；下载包 SHA256 对照官方 release digest，未添加生产依赖。使用 `-shellcheck= -pyflakes=` 仅关闭本地未安装的外部脚本分析器；Actions 自身上下文/表达式语义检查保持。本地继续执行 JS/YAML/bash/JSON/文档及 diff 静态检查，不将这些结果记作 Windows 产品测试通过。修正提交结果仍待用户后续查询。

本地仅进行修改 JS 的 node --check、YAML 和 shell block 静态语法、JSON/文件/文档关系及 diff 检查；未在 Linux 执行产品测试、编译、构建、浏览器或 WebView 验收。新增 Node 契约与所有动态检查由 Windows 执行。

下一批必须依据原生结果选择公共边界，覆盖 Preview 全量/块/虚拟路径和 Hybrid HTML Widget；处理事件、危险 URL/嵌入、DOM clobbering、样式/资源与 native IPC，不只去掉 script。核对合法 Markdown、图片、公式和 Mermaid 的真实 Windows 显示回归，并验证恶意内容不能执行、导航或取得不应允许的原生命令访问。无法证明安全或已确认风险未修复则阻塞本项及 R13。当前不关闭 A03、不接受 12.22，也不启动 12.23。

按用户要求，本批推送触发 Actions 后结束，不轮询。新增原生 host 冷构建可能超过此前批次，约 20～30 分钟后由用户发起“查询 R12-22 CI”。

## 版本和 API 依据

已核对生产锁文件 Tauri 2.11.5、tauri-utils 2.9.3、DOMPurify 3.4.13（现有 Mermaid 传递依赖）；本批未更改生产依赖。Windows 驱动沿用 selenium-webdriver 4.34.0 临时安装，不写入生产 package.json。

已使用 Context7 查询 DOMPurify、Tauri v2 CSP 及 Selenium async script API，并结合当前锁与代码检查。Context7 文档索引未提供精确锁版本分支，未声称查询结果等于精确版本证明；后续实现需继续核对锁定版本 API。DOMPurify 不净化 CSS，也不自动禁止资源请求，因此不能只接入默认 sanitizer 就宣称边界完整。已用 Mermaid Chart 绘制本批实际原生探测链路。

- [GitHub Actions 上下文位置限制](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability)
- [GitHub Actions GITHUB_ENV](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-environment-variable)
- [actionlint 1.7.12](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)
- [Tauri v2 CSP](https://v2.tauri.app/security/csp/)
- [DOMPurify 官方文档与安全目标](https://github.com/cure53/DOMPurify)
- [Selenium JavaScript WebDriver](https://www.selenium.dev/selenium/docs/api/javascript/WebDriver.html)
- [机器可读状态](audit/r12-22-html-boundary.json)

## 本轮按原生证据实施的整改

已读取基线 artifact `11092090676` 的 `render-boundary-baseline.json`：四面均保留 onerror/onclick/onload，执行 img error、button click 和 srcdoc 标记；四面 IPC 返回专用 canary 的固定文字；固定图片/CSS 各有请求；response CSP 为 null、meta CSP 为空。风险已复现，基线 job 的绿色仅证明探测完成。

`src/shared/security/document-html.js` 是唯一文档 HTML 安全策略 owner，显式依赖锁定 DOMPurify 3.4.13（从已锁定的 Mermaid 传递依赖提升为直接依赖，不升级任何已解析包）。每个真实 document 使用独立 purifier，缺少真实 DOM 或不支持净化时直接拒绝，无 raw HTML 降级。返回 DOM fragment 并直接挂载，避免净化后重新序列化/解析。Preview 整体、默认 Block View（含虚拟窗口所用 createBlockNodes）和 Hybrid HTML View 均调用该 owner；源 Markdown、模型、source-range 和增量复用规则保留。

策略使用 HTML 标签/属性允许清单，拒绝事件、script/SVG/MathML/iframe/object/embed/form/template/style、srcdoc/srcset/formaction/name，以及能伪装应用命令的 data 属性和 CSS 类。ID 由 DOMPurify 加 user-content 前缀，hash 链接对应前缀；应用自行设置的源范围/块标识在净化后赋予。raw HTML 仅保留六位十六进制 color/background-color；任意样式、URL、定位、覆盖和选择器不进入主 DOM。checkbox 只保留被动禁用显示。外链仅允许完整 http/https/mailto/tel，危险/相对导航移除；现有捕获处理器仍拥有链接预览及明确系统打开，未被处理的 click/auxclick 不直接导航 WebView。

正常图片允许被动 http/https、已支持的 asset/blob 和限定 base64 位图 data URL，禁止 IPC host、凭据 URL、HTML data URL 和 srcset；图片不发 referrer。外部图片本身的下载是既有合法行为，因此固定 loopback image marker 可以出现，不能把它误判为脚本外传；CSS marker 必须为零。没有承诺离线或禁止所有图片网络请求。

生产/开发 CSP 显式启用：script-src self、script-src-attr none，不放行 inline/eval 脚本；object/base/form 均 none，connect 只允许本应用与 native IPC，开发额外允许固定 Vite websocket；worker 保留 self/blob。图片保留正常来源，字体仅 self/data；style-src-elem/style-src-attr 允许可信 UI/KaTeX/Mermaid 的动态样式，文档 CSS 已由公共边界限制。frame-src 的 http/https 仅保留现有用户点击后创建的链接预览，文档 iframe 被净化移除；新增网页来源的完整验收仍属于 R13 已有任务。Tauri 自动注入 CSP nonces/hashes，不修改或削弱该机制。共享 Mermaid 明确 strict，并保护 securityLevel、dompurifyConfig、themeCSS 等配置键，禁止文档指令降低安全等级。

## 修复后硬性 Windows 验证

同一真实原生 host、前端 dist、生产 Cargo.lock 保护及全部累计门禁保持。现有 runner 增加 `--verify`，输出 `render-boundary-verification.json`；默认历史观察模式保留。四个原入口加实际 canonical createBlockNodes 虚拟块工厂，共五面；后者验证实际虚拟挂载所用工厂，不声称已运行大文档滚动性能验收。

每面必须无事件属性/事件标记/危险 URL/嵌入/命令伪装/不受限 CSS，URL 不改变，IPC 未尝试且没有结果，CSS 标记请求为零，正常文字和有限颜色保留。增加编码 URL、HTML data URL、srcset、DOM clobbering、命令 data 属性、覆盖样式及 mutation-XSS 样例。驱动正常调用自有 canary 仍必须到达真实 Rust，用于排除 IPC 被整体禁用而造成的假通过。另由驱动创建绕过净化的测试 button，验证实际 CSP 独立阻断 inline handler，并记录 script-src-attr violation。随后在真实 both/hybrid 两种布局装载合法 Markdown，等待实际位图加载、KaTeX、Mermaid SVG、details/emphasis/bold，并保留截图。任何断言失败均失败退出，先持久化部分证据，保留 artifact；累计 Node/Rust/架构/编译等失败也阻止验收。

本地只进行修改 JS 语法、actionlint、YAML/bash、JSON/清单/导入/差异等静态复核。当前不是 Windows 环境，不执行 Linux 产品测试或构建；所有动态验收由 Windows CI 执行。README/任务书暂记实施完待 Windows，不能提前关闭 A03。

本轮 Context7 已查询 DOMPurify 返回 fragment/允许清单/资源策略和 Mermaid strict/secure；Tauri 的 Context7 库返回 library_not_finalized，改读官方 CSP 文档并核对当前配置。已使用 Mermaid Chart 更新实际公共净化链路图。版本索引不代表精确包实现，真实锁版本的动态行为由 Windows 回归核对。

本次推送触发 Actions 后结束，不轮询；约 15～20 分钟后由用户发起“查询 R12-22 CI”。
