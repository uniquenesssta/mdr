# Atomic 6.5 — Toolbar Boundary

## 实现

- 新增 `ToolbarBoundaryController`：唯一负责真实内容宽度测量、窄屏强制换行、`toolbar-boundary-wrap` DOM 投影、RAF 调度，以及 `ResizeObserver`/resize fallback 生命周期。
- 控制器通过显式依赖接收 toolbar DOM、`matchMedia`、`getComputedStyle`、frame API、Observer factory、字体就绪 Promise 与性能记录端口；自身不读取 `window`、`document` 或存储。
- `core.js` 删除旧 Toolbar Boundary 状态、测量、RAF 和 Observer 权威；语言刷新、设置保存及用户工具栏可见性变更经现有 Editor UI command port 请求控制器重新测量。
- `toolbarHiddenItems` 继续仅表示用户主动配置的工具可见性；6.5 不通过自动隐藏工具解决宽度不足。
- 补齐 wrapped 父容器 `flex-wrap: wrap`，确保边界状态实际形成双行，而不是只改变两个子组宽度。

## 兼容性

- 继续按 `formatGroup.scrollWidth + actions.scrollWidth + gap` 与 toolbar 可用宽度比较；窄屏阈值复用 `responsive-breakpoints.js` 的 768 px policy。
- Toolbar 设置 key/default、用户隐藏工具配置、LayoutState、文档持久化、Rust/Tauri DTO、安全/权限与生产依赖均未修改。
- Frozen DocumentModel 保持精确冻结。

## 验证

- Atomic 6.1–6.5 专项、Stage 4/5 handoff、Frozen DocumentModel、Architecture、`npm test`、browser contract、build、built-app：PASS。
- `npm audit --audit-level=low`：0 vulnerabilities。
- built-app 在宽屏下通过真实内容宽度主动压缩 toolbar，验证 ResizeObserver 触发双行；恢复宽度后回到单行，过程中用户工具隐藏状态保持完全一致：PASS。
- destroy 覆盖 Observer disconnect、RAF 取消、fallback resize listener 清理及字体 Promise 过时完成抑制：PASS。
