# Atomic 6.1 — Layout State

## 完成内容

- 新建 `src/features/layout/` 公共入口、`state/layout-state.js`、`shell/responsive-breakpoints.js` 与 scoped classic LayoutState port。
- LayoutState 成为 sidebar 可见性/宽度、split 折叠/比例、layout mode、compact shell/split、fullscreen 与跨模块 resize 活跃状态的唯一运行时 owner；快照不可变并支持显式订阅与终止销毁。
- `core/bootstrap/editor-tools/events/preview/scroll-sync` 不再共享第二份布局词法状态，只通过 Layout 公共入口挂载的 scoped port 访问 LayoutState。
- 运行时 layout mode 不再从 Settings Store 反向充当布局状态；Settings Store 仍只负责持久化偏好，启动和设置变更时同步到 LayoutState。
- JS 响应式阈值统一到 `responsive-breakpoints.js`，保持既有 860/900 compact-shell 回差、720/760 compact-split 回差和 768 窄屏行为不变。
- 6.1 只迁移状态所有权。sidebar/split 的 DOMRect、RAF、Observer、指针捕获、CSS 写入和持久化行为仍留在旧控制逻辑，分别由 6.2/6.3 后续 Atomic 接管，不在本任务提前重写。
- `stage-06-atomic.yml` 延续 Stage 4/5 全部既有门禁，并新增 Atomic 6.1 Layout State 专项、Frozen DocumentModel、Architecture、Node、浏览器 contract、Build 与 built-app 回归。

## 兼容性

Frozen DocumentModel、持久化 key/格式、Settings schema/default、Rust/Tauri DTO、生产依赖和用户可观察布局行为未修改。classic LayoutState port 是 Stage 6 分阶段迁移边界，本身不持有状态。

## 验证

GitHub-hosted runner `31470348252` 对 6.1 已验证源码候选实际执行并通过：

- 受保护 Stage 6 基线与 Frozen DocumentModel blob 校验：`d767d9025be05a6f6b87d7cd3527782db1c3303a`
- `npm run deps:prepare`
- `npm audit --audit-level=low`：0 vulnerabilities
- Atomic 6.1 focused unit/architecture：14/14 PASS
- `core/bootstrap/editor-tools/events/preview/scroll-sync` classic script syntax：PASS
- `npm run verify:architecture`：PASS
- `npm test`：44/44 PASS
- `npm run test:browser:contract`：10/10 PASS
- `npm run build`：PASS
- `npm run test:browser`：PASS，包含完整应用交互与 Browser exception audit

发布前仍会对加入本记录和 Stage 6 workflow 后的精确最终候选 tree 按正式 Stage 6 粒度重跑全链；正式分支推送后由 `Stage 6 Atomic Verification` 再执行一次同级验证。

本地临时容器未作为验收环境；真实依赖、Node、浏览器、Build 与 built-app 验证均由 GitHub-hosted runner执行。
