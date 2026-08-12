# Atomic 6.9 — Folder Tree

## 任务边界

Atomic 6.9 只迁移 Folder Tree。目标是把旧 `src/sidebar/folder-file-tree.js` 的多职责实现拆成可独立描述、测试和销毁的模块，同时保持现有文件树行为、文件打开语义、Sidebar Tabs 生命周期和平台文件读取契约。Atomic 6.10 Menu Model 未开始。

## 实际实现

新增并通过 `src/features/sidebar/index.js` 暴露以下职责模块：

- `folder-tree/folder-tree-path-policy.js`：纯路径规范化、父目录、同路径与目录包含判断。
- `folder-tree/folder-tree-normalizer.js`：纯 DTO 规范化、可读扩展名过滤和目录优先稳定排序。
- `folder-tree/folder-tree-state.js`：Folder Tree 运行时与目录展开状态的唯一状态权威，提供不可变 snapshot 和终止式 `destroy()`。
- `folder-tree/folder-tree-controller.js`：生命周期、FilesPort 读取、缓存复用、stale request 淘汰、打开文件协调、错误和性能记录。
- `folder-tree/folder-tree-view.js`：面板/header/list 投影、刷新按钮与键盘监听器生命周期。
- `folder-tree/folder-tree-node-view.js`：单节点 DOM、展开/文件点击和递归子节点 listener 清理。
- `compatibility/classic-folder-tree-controller-port.js`：剩余 classic 文档调用到 canonical Controller 的 scoped 兼容桥，不复制树、展开或平台状态。

已删除旧 `src/sidebar/folder-file-tree.js`，没有保留转发壳或第二实现路径。

## 调用链与所有权

- 文件树读取继续只通过现有 `platform.files.listTextTree()` / FilesPort；没有新增 Rust 文件命令，也没有绕过 Platform 访问文件系统。
- Sidebar 6.7 只负责 tab lifecycle，`files` lifecycle 改为 canonical `FolderTreeController`，没有把树数据或展开状态并入 Sidebar Tabs。
- classic 文档路径变化通过 `markdownEditorFolderTreeControllerPort.syncCurrentDocument()` 同步当前文件。
- Folder Tree 打开文件通过现有 Document UI command port 的 `openFolderTreeFile` 命令进入既有文档打开/复用流程。
- 移除 `window.markdownEditorFileTree`、main 对 `window.openFolderTreeFile` 与 `window.handleNativeDroppedPath` 的 Folder Tree 依赖。
- 对应 architecture baseline 中 3 条已实际消失的业务全局债精确删除；当前业务全局基线计数由 36 降为 33，历史 Stage 1 证据未改。

## 保持不变的行为

- 只显示 `.md`、`.markdown`、`.txt`。
- 目录优先、稳定排序；非法节点和不可读扩展名继续过滤。
- 根层目录默认展开，用户展开/折叠状态由独立 FolderTreeState 持有。
- 当前文件继续使用 active/`aria-current="page"` 投影。
- Refresh、ArrowLeft/ArrowRight、文件点击、加载/空状态/错误提示语义保持。
- 同一根目录内切换文档继续复用已加载 tree；跨目录重新读取。
- stale 异步结果、deactivate 和 destroy 后的旧结果不会覆盖当前状态。
- 打开文件时按钮禁用并在异步结束后恢复。
- `sidebar.file-tree-loaded` / `sidebar.file-tree-load-error` 性能事件保持。
- 没有修改公共持久化格式、配置、默认值、安全策略或 Frozen DocumentModel。

## 验证事实

候选发布前已实际执行：

- Preflight：run `31564226053` — PASS；正式基线精确锁定、真实工作区 clean、规则/任务书可读、Frozen hash 正确。
- 旧行为基线：run `31564583387` — PASS；原 Folder Tree Node/Platform 测试和 browser contract 通过。
- 6.9 专项 materialization：run `31565420856` — PASS；路径策略、规范化、状态、Controller、compat port、6.7/6.8 阶段边界、Platform 与 Sprite 门禁通过。
- Architecture + 全量 Node：run `31565562819` — PASS；仅迁移 3 条已消失的 Folder Tree 业务全局基线。
- Browser contract + build + built-app：run `31565628260` — PASS；包含新 Tree/View/NodeView 交互、展开状态、文件打开、destroy listener 清理，以及 built-app Sidebar lifecycle/no legacy tree global。
- `npm audit` 在依赖准备输出中为 `0 vulnerabilities`。
- Frozen `src/document/document-model.js` hash 保持 `d767d9025be05a6f6b87d7cd3527782db1c3303a`。

## 兼容性与限制

本 Atomic 未新增生产依赖，未修改 Rust 文件树命令，未开始 6.10 Menu Model。classic compatibility port 仅用于剩余 classic 文档调用，退出条件是对应 classic 文档调用链后续完成迁移；它不拥有第二份 Folder Tree 状态。
