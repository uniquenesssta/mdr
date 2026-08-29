# Atomic 6.6 — Fullscreen

## 实现

- 新增 `PageFullscreenController`：唯一负责 `fullscreen.page`、页面专注模式四个兼容 class、`md_editor_page_fullscreen` 恢复/持久化与 geometry changed 通知。
- 新增 `SystemFullscreenController`：唯一负责 `fullscreen.system`、平台全屏状态同步、进入/退出与 change subscription 生命周期。
- 页面持久化改用既有 `platform.storage`；系统全屏改用 Stage 3 既有 `platform.fullscreen`，不再从 classic 脚本直接访问浏览器 Fullscreen API。
- `bootstrap.js` 删除页面全屏恢复权威，`events.js` 删除直接 fullscreenchange 监听，`editor-tools.js` 删除全屏状态/DOM/平台实现。
- `togglePageFullscreen` / `toggleFullscreen` 仅保留无状态命令转发，用于 Atomic 6.10 Menu Model 前仍存在的内联菜单兼容；不拥有状态、DOM、持久化或平台副作用。

## 兼容性

- 保持原持久化 key `md_editor_page_fullscreen` 与字符串 `true`/`false` 不变。
- 保持页面专注模式 class：`page-fullscreen`、`is-page-fullscreen`、`page-fullscreen-active`、`is-page-fullscreen-active`。
- 保持编辑器 action ID `page-fullscreen` / `system-fullscreen` 和 UI command 名称不变。
- 保持页面专注模式开/关提示文本不变；系统不支持仍使用 `toastNoFullscreenApi`。
- 浏览器缺少 Fullscreen capability 时不调用 unsupported port，返回受控 `{ supported:false, reason:'unsupported' }` 结果。
- Frozen DocumentModel、数据格式、Rust/Tauri DTO、安全权限及生产依赖均未修改。

## 验证

- Atomic 6.6 Page/System Fullscreen unit + architecture：PASS。
- Stage 4、Stage 5、Atomic 6.1–6.5 回归与 Frozen DocumentModel：PASS。
- Architecture、Node、browser contract、build、built-app：PASS。
- built-app 通过现有 Editor UI command ID 实际切换页面全屏，验证 LayoutState、四个 class、持久化进入/退出一致：PASS。
- System Fullscreen 覆盖 supported enter/exit、unsupported controlled result、operation failure evidence、subscription disposer 与 stale callback suppression：PASS。
