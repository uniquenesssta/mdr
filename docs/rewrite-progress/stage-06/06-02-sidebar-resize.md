# Atomic 6.2 — Sidebar Resize Controller

## 完成内容

- 新建 `src/features/layout/sidebar/sidebar-resize-controller.js`，由 Layout 公共入口导出。
- Sidebar Resize Controller 独立负责 pointer capture、拖动生命周期、宽度边界、`--sidebar-width` CSS 投影、ARIA 值、`md_editor_sidebar_width` 持久化、viewport clamp 与结束几何通知。
- Sidebar 宽度继续写入 Atomic 6.1 的唯一 `LayoutState`；没有新增第二份 sidebar/resize 状态。
- `public/app/core.js` 与 `public/app/bootstrap.js` 已移除旧 sidebar resize 行为链和宽度恢复/投影职责。
- `src/main.js` 只负责依赖装配和 `start()/destroy()` 生命周期；scroll geometry 通过显式 callback 通知。
- 普通 split resize 的 `startResize/stopResize/onResizeMove`、ratio 与相关内部状态保持原位，留给 Atomic 6.3。

## 兼容性

- 保持既有宽度策略：默认 248px、最小 180px、绝对最大 520px、动态最大值 `max(240, min(520, workspaceWidth - 360))`。
- 保持持久化 key `md_editor_sidebar_width` 与存储格式不变。
- 窄屏判定继续使用 Stage 6 统一 responsive breakpoint 入口，不复制 768 阈值。
- Frozen DocumentModel、Settings schema/default、Rust/Tauri DTO 与生产依赖均未修改。

## 验证

候选提交 `23bb1caff85687b31dbaee900b192b705c249c73` 在 GitHub Actions run `31473389554` 实际完成以下验证：

- `npm audit --audit-level=low`：0 vulnerabilities。
- Atomic 6.2 + 6.1 专项单元/架构测试：23/23 PASS。
- 修改后的 classic/E2E 脚本 `node --check`：PASS。
- Frozen DocumentModel hash：`d767d9025be05a6f6b87d7cd3527782db1c3303a`，PASS。
- `npm run verify:architecture`：PASS。
- `npm test`：44/44 PASS。
- `npm run test:browser:contract`：10/10 PASS。
- `npm run build`：PASS。
- `npm run test:browser`：23/23 PASS；其中真实 Chrome Pointer Drag 用例确认 sidebar resize 的 pointer capture、CSS 宽度、ARIA、最终持久化和拖拽结束清理全部通过。
- 诊断 artifact 已成功上传。

正式 `rewrite/stage-06` 发布后的独立 Stage 6 CI 不在此处预先记为通过。
