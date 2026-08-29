# Atomic 6.8 — Outline

## 结果

Atomic 6.8 已将 Outline 从经典脚本中的共享缓存、折叠对象、全文回退解析、字符串 DOM 渲染和内联事件迁移到 `src/features/sidebar/outline/`。Outline 现在只消费既有 Document/Preview 索引产出的标题数据，不重新扫描完整编辑器文本；6.9 Folder Tree 未开始。

## 模块与职责

- `outline-tree-builder.js`：纯函数规范化既有 heading index / preview heading blocks，并构建不可变层级树；不读取编辑器全文、DocumentModel、DOM、Storage 或浏览器全局。
- `outline-active-heading.js`：只按 source line 在已排序 heading index 中解析当前 active heading。
- `outline-collapse-store.js`：唯一拥有折叠 ID 集合及持久化；保持原 key `md_editor_outline_collapsed`。
- `outline-view.js`：唯一拥有 Outline DOM 投影、列表点击与 Outline context-menu delegated listener；不使用 `innerHTML`。
- `outline-controller.js`：唯一编排当前 document identity/version、heading index、tree、active line、render lifecycle 与 stale-index rejection。
- `classic-outline-controller-port.js`：剩余 classic Preview/Core/Scroll Sync 的无状态 Stage 6 过渡端口，不复制 Outline 状态；classic 调用迁完后删除。

## 调用链与边界

- Preview worker 已有增量 heading index 继续作为主要标题索引来源；Preview blocks 仅作为已索引 heading block 的兼容输入。
- Core 的原生清单、持久化 document index 与 document-load index 改为写入 Outline Controller；document index 持久化职责保持原位。
- Preview 不再直接 `renderOutline()` 或维护 heading cache；Scroll Sync 的 4 条 active-heading 路径统一进入 Outline port。
- Sidebar 6.7 继续只负责 mount 切换；`registerLifecycle('outline', outlineController)` 负责激活/暂停渲染。
- Editor 定位使用既有 Virtual Editor API；预览聚焦与 context menu 通过既有 Editor UI compatibility command port 注入，不新增业务全局。
- `src/sidebar/folder-file-tree.js` 保持原实现，6.9 未开始。

## 兼容性

- 保持 `md_editor_outline_collapsed` 持久化格式与行为。
- 保持原 Outline tab/panel、层级 class、折叠/展开、active heading 与标题导航语义。
- Frozen `src/document/document-model.js` 未修改。
- 无新增生产依赖，无公共数据格式、配置项、默认值或权限变化。
- 已迁出的 4 个 Outline inline handler 从当前架构基线精确删除；Stage 1 历史证据未改。

## 验证

- Atomic 6.8 focused：`31552721279` — PASS（21/21，含 no-full-source-reparse、stale index、collapse persistence、active heading、View lifecycle、6.9 未启动）。
- Architecture + complete Node：`31553187307` — PASS。
- Built-app isolated final interaction：`31554479736` — PASS（29/29；真实验证 4 级树、active heading、折叠持久化/恢复与标题导航）。
- Exact source candidate：`31554565762` 第二次完整 job — PASS：dependency audit、Stage 4、Stage 5、Stage 6.1–6.8、Frozen、Architecture、Node、browser contract、build、built-app、evidence 全部通过。
- `npm audit --audit-level=low`：0 vulnerabilities。

## 已知限制与后续

- classic Outline compatibility port 仍是 Stage 6 临时迁移桥；待剩余 classic 调用移除后删除。
- Folder Tree 仍保持 Stage 6.7 既有控制器与路径；其独立拆分属于 Atomic 6.9。
