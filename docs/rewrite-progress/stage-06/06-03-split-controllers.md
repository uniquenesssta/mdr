# Atomic 6.3 — Split Controllers

## 实际实现
- 新增 `split-pane-controller.js`：只负责 pane 折叠/展开、折叠持久化和 pane/resizer 折叠态投影。
- 新增 `split-resize-controller.js`：只负责普通双栏 Pointer Capture 拖动、15%–85% 比例边界、比例持久化和 flex 投影。
- 新增 `compact-split-controller.js`：只负责 compact split 进入/退出回差（720/760）、互斥 pane 选择和折叠 pane 激活。
- 剩余 classic 布局模式调用只通过 scoped、无状态 `markdownEditorSplitControllerPort` 转入新控制器；不再保留 `core.js` 第二套 split 权威实现。
- Layout Controllers 对下游只发送 geometry-changed callback；Preview 继续由既有 ResizeObserver 处理可见/尺寸刷新，Scroll Controller 继续处理几何重同步。

## 影响与兼容性
- `md_editor_ratio`、`md_editor_editor_collapsed`、`md_editor_preview_collapsed` 键保持不变。
- 普通 split 比例仍限制为 0.15–0.85；compact split 继续使用共享 720/760 回差；两 pane 仍禁止同时折叠。
- 未改 DocumentModel、文档格式、设置默认值、公共数据结构，也未进入 Atomic 6.4 Compact Shell。
- Preview collapse 的旧 inline `onclick` 已移除；事件所有权转入 SplitPaneController。

## 本候选实际验证
- `npm audit --audit-level=low`：PASS。
- Atomic 6.1 / 6.2 回归：PASS。
- Atomic 6.3 单元与架构专项：PASS。
- Frozen DocumentModel hash：PASS。
- `npm run verify:architecture`：PASS。
- `npm test`：PASS。
- `npm run test:browser:contract`：PASS。
- `npm run build`：PASS。
- `npm run test:browser`：PASS；包含真实 split Pointer Drag、pane collapse 和 720/760 compact hysteresis。

## 已知限制
- `editor-tools.js` 尚未在本 Atomic 重写，其布局模式入口暂时通过 scoped migration port 调用 Split Controllers；该 port 不持有状态或 DOM 逻辑。
- Atomic 6.4 Compact Shell 未开始。
