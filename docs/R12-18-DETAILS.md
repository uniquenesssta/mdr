# R12-18 审计门禁与真实清单整改（A02）

状态：审计门禁整改已验收。Windows 当前提交仅剩已归属 R12-22 的真实 Preview 循环依赖；不代表产品全绿。

生产源码、8 个冻结 JS 模型、Rust 持久化格式、依赖及锁文件均未修改。生产清单从漏报的 448 项补齐到实际 493 项；此数仅为本次观测，不是后续门禁常量。新增精确集合门禁，同时拒绝缺失、重复和不存在的记录。

## 断言覆盖映射

完整 40 项历史失败分类与被替换的历史提取断言见 [机器可读证据](audit/r12-18-gate-validation.json)。历史基准为 R12-17 Windows 运行 36607929723：1434 项，1394 通过，40 失败。

| 旧门禁 | 当前覆盖 |
|---|---|
| 381/442 等当前模块固定总数 | 每次发现实际生产文件，与清单逐项比较；功能专属记录仍校验 |
| 删除的 scroll-sync、image-source、widgets 路径 | 当前 Sync、Image Resolver、Widget Actions；保留旧文件删除检查 |
| events 中旧关闭保存实现 | Persistence CloseSaveController 的强制快照、失败决策；Window 仅依赖 CloseSavePort |
| 内部 Hybrid Facet 命名导出 | 公共配置工厂提供的 Facet 配置，仍在真实 EditorState 上检查变更及重建 |
| 当前 README 的旧 Stage、120～360 字符限制 | 当前记录结构、详情链接；历史事实从历史记录读取 |
| Rust document_store.rs 整文件冻结 | 8 JS 模型哈希不变；Rust document_store_compatibility 格式、AB 快照及 journal 恢复测试 |
| 逆向拼回旧 Rust 文件再逐字比较 | 当前真实 entry/command/专属 owner 接口和依赖边界；19 项注册名、顺序、参数与返回类型 |
| 当前依赖文件必须等于历史 blob | 历史 SHA 验证历史 manifest；当前依赖由 locked 构建、Clippy、行为回归及 12.23 公告审查 |
| 每轮重复编译 11～17 的全部历史版本 | 保留原验收证据；当前完整 Rust、真实 HTTP/I/O、release 不写日志及 native linkage；本轮无生产行为修改，无需重复历史构建 |

Scroll 的旧 resize 全局读取检查转为当前 SplitResizeController 注入 LayoutState 并通知 ScrollSync geometry 的连接断言，继续禁止第二个 resize 状态权威。后续行为问题不得通过改写基线消失。

## 当前实际 CI

保留递归 `git ls-files -z tests` 枚举所有跟踪的 `.test.mjs`，逐目录执行并归档完整清单与结果；任何有效失败均返回非零。没有 skip、ignore、continue-on-error 或清理失败的豁免。

Windows 执行当前 Node 全量、架构/文档、Rust 全量、格式、Clippy、cargo check、前端构建、浏览器、真实 HTTP、日志落盘/故障及 release 不写日志、Windows opener 编译链接。Native linkage 不冒充 Windows 真实 ShellExecute/WebView 调用；完整调用矩阵仍按任务书验收。

## 已知真实问题与责任

补齐清单后新增暴露 R18-N01：`Preview index → virtual-preview-controller → Preview index` 循环依赖。保留架构门禁失败，归 R12-22 Preview 边界整改，R12-24 必须关闭；本轮不调整产品实现，不添加白名单。

既有产品发现继续按原排程：A07/A08/A09 → 12.19；A01 收尾 → 12.20；A06 → 12.21；A03及本次Preview依赖问题 → 12.22；A10 → 12.23。12.24 要求无未解释失败，不以本项治理代替产品验收。

## 验证状态

本地只执行源码/清单/文档静态检查：103 项源码契约、165 项布局/所有权/文档检查、46 项补充静态检查及 1 项清单门禁反例检查通过；未执行 Linux 产品运行验证。Windows 最终证据见下文。

Mermaid Chart 展示实际验证链路；Context7 核对锁定的 CodeMirror State 6.7.1 Facet/EditorState 配置读取 API。生产依赖未修改。

补充：移除 Writer 必须直接 `fs::write` 的实现断言，改保留签名和真实读写语义，避免阻止 12.21 安全替换写入。架构、旧运行时、生成文件和文档门禁分别执行，真实架构失败不会中断其他门禁的证据收集。

## 首轮 Windows 与门禁修正

运行 [36614535482](https://github.com/uniquenesssta/mdr/actions/runs/36614535482)，提交 `5dc5b9673f4f9b6d632658b796ce98dadd3361ef`：递归 Node 1442 项，1436 通过、6 失败；Rust 241/241、前端专项 127/127、构建和浏览器通过。Clippy/格式未完成验收：模型测试早于 npm 依赖准备，失败后工具链准备被跳过；已将模型测试放到前端依赖安装后，Rust 工具链先于守卫准备。

六项 Node 失败中：架构循环依赖保留；3 条引用其他测试中固定模块数的断言、1 条 Hybrid 专属 CodeMirror 兼容端口所有权、1 条已迁移 readChunk 责任断言属于 A02，已按真实责任替换。没有跳过或修改保存行为用例。

扫描器把 `globalThis.foo === ...` 误认作赋值。修正赋值运算符匹配，新增比较/赋值反例；仅移除两条经源文件确认从未赋值的旧基线记录：e2e-bridge 的 `__MARKDOWN_EDITOR_E2E__` 比较和 link-preview 的 `showToast` 能力检查。修正有明确审计元数据，不重新生成基线、不放行任何真实全局写入。新补入的 PreviewScheduler 四条同类能力读取也不再误报。

CodeMirror 只允许实际已迁移的 `hybrid-editor/compatibility/codemirror-source-editor-port.js`，继续扫描其他 Hybrid 模块；未对整个 Hybrid 功能开放 CodeMirror 导入。

## 第二轮 Windows 验收

运行 [36616863617](https://github.com/uniquenesssta/mdr/actions/runs/36616863617)，提交 `601e3148b324d0a2401b1e0459e09a02fcb09d58`：递归 Node 1445 项，1444 通过、1 失败；专项 135/135、Rust 241/241、格式、Clippy、cargo check、native linkage、前端构建及浏览器通过。唯一失败为 R18-N01 Preview 循环依赖，架构门禁保持红色，责任仍为 R12-22。A02 过时门禁已关闭，12.18 按其治理验收条件勾选。
