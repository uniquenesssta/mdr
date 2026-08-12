# Atomic 6.7 — Sidebar Tabs

## 结果

Atomic 6.7 将 Sidebar Tabs 从经典脚本中的共享变量、DOM 投影和 localStorage 直写迁移到独立 Sidebar feature。只切换 `docs/files/outline` 挂载区域，不接管文档列表、文件树数据或大纲算法。

## 实现

- `SidebarState`：唯一拥有当前 `activeTab`，限定 `docs/files/outline`，发布不可变快照。
- `SidebarTabController`：拥有 tab/panel `active` 投影、`md_editor_sidebar_tab` 恢复/持久化、tab click 监听及子控制器 activate/deactivate 协调。
- `classic-sidebar-controller-port`：剩余 classic 调用的无状态过渡端口，不复制 Sidebar 状态。
- Documents 的 `DocumentListView` 继续唯一拥有 `#document-list` 渲染与 Session 订阅。
- 既有 `folder-file-tree.js` 直接以 `activate/deactivate` 注册为 files lifecycle；其结构与读取算法留给 6.9。
- 经典 `renderOutline` 仅注册为 outline 激活回调；heading/collapse/render/index 逻辑仍留在原位置，等待 6.8。
- 删除 `activeSidebarTab`、`SIDEBAR_TAB_KEY`、classic `setSidebarTab()` DOM/persistence 权威以及三个 tab 的内联 `onclick`。

## 兼容性

- 持久化 key 保持 `md_editor_sidebar_tab`。
- tab ID、panel ID、`active` class 和用户可见切换语义保持不变。
- 新建/复制/导入文档仍切回 Documents；文件树打开文件仍保持 Files。
- 不改变 DocumentModel、Documents 数据结构、文件树读取格式、大纲结构、菜单命令或公共持久化格式。
- 6.8 Outline 与 6.9 Folder Tree 未开始。

## 验证

- Atomic 6.7 专项：`31550130621`，PASS。
- 首次最终 exact-SHA 全链：`31551133781`，PASS。
- Stage 4 handoff：PASS。
- Stage 5 handoff：PASS。
- Stage 6.1–6.7：PASS。
- Frozen DocumentModel：blob `d767d9025be05a6f6b87d7cd3527782db1c3303a`，PASS。
- Architecture hard gate：PASS。
- Node regression：PASS。
- browser interaction contract：PASS。
- production build：PASS。
- built-app regression：PASS；真实验证三 tab 单挂载区切换、`md_editor_sidebar_tab` 持久化、files activate/deactivate、outline 激活刷新、Documents 列表所有权保持。
- `npm audit --audit-level=low`：0 vulnerabilities。

验证期间发现并修正两类仅属于迁移验收基线的问题：三条已删除的 Sidebar inline `onclick` 从当前架构基线精确移除；旧 Folder Tree/Stage 1 当前计数断言更新到新的职责位置与当前值。未删除、跳过或弱化任何硬门禁。正式发布前还会对包含本验收记录的最终候选 SHA 再执行一次完整 exact-SHA 验证。
