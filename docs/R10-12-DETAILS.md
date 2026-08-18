# R10-12 删除旧保存代码

- 实现：从 `public/app/export.js`、`core.js`、`events.js` 移除手动保存/Autosave 直接实现与经典 Save/Autosave Controller 依赖；两个仅服务旧调用者的 compatibility bridge 已删除。
- 边界：SaveController 新增当前文件保存与 Markdown Save As 编排，文件写入、选择器、标题归一化均由组合根注入；AutosaveController 仍唯一拥有去抖和设置订阅。
- 调用：Ctrl/Cmd+S、Ctrl/Cmd+Shift+S、文件菜单、标题/编辑事务和文档切换均通过显式 Editor/Document command boundary；导出模块只保留导出与导入展示流程。Built-app 生命周期回归同步改为通过 `markdownEditorEditorUiCommandPort` 调用迁移后的 `saveCurrentFile`，不再依赖已删除的 `saveToLocal`。
- 兼容：桌面已有路径直接写；首次保存/Save As 保持选择器取消语义；浏览器继续下载 Markdown；首次路径绑定在内部 persistence generation 校验完成后执行。Save As 在文件选择器或非活动文档读取期间发生 generation 变化时，会在外部写入和路径绑定前拒绝过时结果。
- 架构基线：R10-12 删除两个文件菜单内联保存处理器后，精确 migration baseline 从 43 个 inline event 降为 41；生产模块 inventory 为 394。Stage 1 历史交接数字仍保留为历史事实，当前 migration baseline 单独校验。
- 范围：未修改冻结模型、Rust、DTO、持久化格式、package/lockfile；R10-13 及后续 main/index 收口未提前实施。
- 验证：GitHub Actions `R10-12 Remove Legacy Save Code` run `32135979778` 在提交树上通过：R10-12 11/11、SaveController 8/8、AutosaveController 9/9、R10-11 10/10、R10-10 10/10、R10-09 10/10、Documents Session 11/11、R10-08 8/8、R10-07 10/10、R10-06 11/11、R10-05 9/9、完整 Node 344/344、Architecture/No-Legacy/Generated/README、Browser Contract 10/10、production build、Built-app 29/29、clean tree；`npm audit --audit-level=high` 为 0 vulnerabilities。未运行 Rust 检查，因为本 Atomic 未改 Rust、DTO、持久化格式或 native interface。
