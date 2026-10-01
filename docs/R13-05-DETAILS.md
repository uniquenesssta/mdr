# R13.5 Drop Overlay

状态：**已验收**。实现提交 `fd9c35d92d81c2cf3cd059c7e41797bfc37a962a` 的 [Windows CI 36853092080](https://github.com/uniquenesssta/mdr/actions/runs/36853092080) 七个 job 全部成功，已具备 13.6 准入条件。唯一分支 `agent/r13-stage`；前置与回退代码基线为 R13.4 `cd85861536344d34f9f4b32ecabca217d0ad9550`，Windows CI 36849373596 七个 job 全部成功。

## 实际变更与所有权

新增 `files/drop-overlay-view.js`，从 Import 公共入口导出 `createDropOverlayView({ element })`。公开冻结的 `setVisible(boolean)`、`destroy()`；仅持有可选 DOM 引用与终态标记，不持有拖放计数、可见性副本、文件读取或业务状态，不注册事件。

main 在遮罩 DOM 已挂载后创建 View，向现有 Drop Import 注册过程显式注入其 setVisible；显示时机仍由 Drop Import 决定。删除 events 中的遮罩查询、DOM 引用与 classList 回调，不增加兼容端口或全局变量。原有 show 样式、结构与文案保持；无遮罩元素时仍允许无操作显示命令，非法元素明确报错。

View 创建时隐藏残留 show；destroy 隐藏并释放 DOM 引用，重复销毁和晚到显示命令不再写 DOM。pagehide 与启动失败均先销毁协调器（隐藏、解绑 DOM/native 监听），再销毁 View，最后卸载 scoped port。视图自身没有监听器，事件解绑由原协调器唯一负责；早于协调器销毁 View 也不会被后续回调重新显示。

## 验证

- 新增 View 契约：初始隐藏、显示/隐藏、保留其他 class、缺失元素兼容、非法元素拒绝、销毁后无 DOM 写入；真实 Drop Import 联调验证嵌套计数、native over、提前销毁 View 和监听释放。
- 原导入矩阵接入真实 View，所有原类型、阈值、错误、过时代次和最近文件断言保留。仅把已迁出的渲染回调替换为实际 View，未删除行为场景。
- R13.4 的真实 Platform + main 组合回归更新到新 View 接线，覆盖 browser/desktop 的实际构造与遮罩可见性、销毁，不再只凭源码正则判断初始化。
- 原 Windows Chromium DOM 拖放 E2E 使用真实 View，保留冒泡/首文件/路由检查，补销毁后调用 setVisible 仍隐藏。
- 分类器接线断言适配 main 的显式命令组合，仍验证公共入口、启动顺序与两个退出路径；生产清单追加一个模块。

本地只执行改动 JS/MJS 的 `node --check`、JSON/模块引用/差异静态检查；不执行 Linux/macOS 产品测试。真实行为、架构、完整启动、Rust、原生/WebView 与依赖回归已由上述七组 Windows CI 验收；2026-10-01 应收尾请求核对精确提交后确认通过。

冻结模型、Rust、持久化格式、图片阈值、网页策略与依赖不变。R13.6/13.7 图片政策与读取、R13.13/13.14 兼容桥退出，以及 A05/A03/A10 移交保持。跨模块所有权通过 Mermaid Chart 复核；未新增第三方 API/依赖。
