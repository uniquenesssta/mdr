# R12-18 审计门禁与真实清单整改（A02）

状态：实现与静态复核完成，Windows 当前提交验收待运行。仅实施 12.18；不启动 12.19～12.23。

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

本地只执行源码/清单/文档静态检查：103 项源码契约、165 项布局/所有权/文档检查通过；未执行 Linux 产品运行验证。Windows 证据待回填；当前不勾选 12.18。

Mermaid Chart 用于展示实际验证链路；未引入第三方 API 或依赖，不需 Context7。
