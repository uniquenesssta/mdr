# Atomic 6.4 — Compact Shell

## 实现

- 新增 `CompactShellController`：860/900 px 回差、窗口 resize burst 状态、RAF/settle timer、根节点 compact class 与完整 destroy 清理。
- 新增 `SidebarLayoutController`：唯一负责 sidebar/resizer 的可见性 DOM 投影，读取 `LayoutState.sidebar`，不复制状态。
- `core.js` 删除旧 compact shell、window resize burst、sidebar DOM 投影实现；通用 View Transition 仅继续读取 LayoutState 的 resize gate。
- 6.5 Toolbar Boundary 保持原位置，未提前迁移。

## 兼容性

- compact shell 进入/退出阈值保持 860/900 px；sidebarVisible 设置、LayoutState 契约及用户可见行为保持。
- Frozen DocumentModel、持久化格式、Settings key/default、Rust/Tauri DTO、安全/权限、生产依赖均未修改。

## 验证

- 6.1–6.3 回归、6.4 专项、Frozen DocumentModel、Architecture、`npm test`、browser contract、build、built-app：PASS。
- `npm audit --audit-level=low`：0 vulnerabilities。
- built-app 覆盖 840→880→920 compact shell 回差、resize burst gate 与 settle 清零：PASS。
- Preview sidebar visibility 残留调用已改接 LayoutState compatibility port，并由架构测试锁定：PASS。
