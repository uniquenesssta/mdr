# Atomic 6.11 — Submenu Positioner

## 任务边界

Atomic 6.11 只迁移子菜单的左右展开、视口边界、延迟关闭和焦点生命周期。几何与定时器职责必须独立于 `menu-view.js`，不得提前迁移 Atomic 6.12 Recent Files Menu 的数据读取、渲染或打开命令。

## 实际实现

新增并通过 `src/features/menu/index.js` 暴露以下职责：

- `submenu-positioner.js`：子菜单 pointer/focus 打开、左右展开、垂直视口夹取、1000ms 延迟关闭、RAF/Timer 取消与 listener 生命周期的唯一权威。
- `compatibility/classic-submenu-positioner-port.js`：仅向剩余 classic 顶层菜单关闭链暴露 canonical `closeAll()`；不拥有几何、timer、hover/focus 或 Recent Files 状态。

`src/bootstrap/module-entry.js` 负责创建 Positioner、挂载 scoped compatibility port、在 classic 应用导入完成后启动，并在启动失败或应用销毁时逆向拆除 port/Positioner。`menu-view.js` 保持只做 Menu Model 到 DOM 的声明投影和 command click delegation，没有加入几何或 timer 逻辑。

## 旧路径移除与调用链

- 从 `public/app/core.js` 删除 `positionAppSubmenu()`、`resetAppSubmenuPosition()`、`initializeAppSubmenus()` 以及 DOM 私有属性 `__markdownEditorCancelSubmenuClose`。
- `closeAppMenus()` 不再直接遍历/重置 submenu DOM，只通过 `markdownEditorSubmenuPositionerPort.closeAll()` 通知 canonical Positioner。
- 从 `public/app/events.js` 删除 classic `initializeAppSubmenus()` 启动调用。
- 不保留 wrapper、第二套 geometry/timer 状态或不可达旧实现。

## 保持不变的行为

- 子菜单仍使用父菜单项局部绝对坐标，避免顶层菜单 transform 动画造成 fixed 坐标二次偏移。
- 右侧空间足够时向右展开；不足时向左翻转，gap 保持 4px。
- 垂直位置继续限制在 8px 视口边距内，并保持原有 6px 顶部偏移语义。
- `.disabled` 子菜单项不打开。
- pointer leave / focus out 继续使用 1000ms 延迟关闭；hover 到 owner/submenu 或焦点仍在 owner 内时保持打开。
- 顶层菜单关闭会同步取消 submenu pending timer/RAF、移除 open class 并清理临时定位样式。
- Recent Files DOM slot、数据和打开逻辑保持现状，Atomic 6.12 未开始。
- 未修改 Frozen DocumentModel、持久化格式、Rust API、配置、默认值、安全策略或生产依赖。

## 验证事实

候选 Stage 6 全链 run `31577907476` 已实际 PASS：

- Stage 4 handoff、Stage 5 全部 Atomic/CR-05、Stage 6.1–6.10 回归全部 PASS。
- Atomic 6.11 单元/架构/公共入口专项 PASS；覆盖左右翻转、垂直边界、hover/focus 延迟关闭、disabled 行为、`closeAll()`、destroy listener/timer/RAF 清理、classic port 单一委托，以及 6.12 文件仍不存在。
- 真实 Chromium 500×300 视口合约 PASS；确认右侧空间不足时向左翻转、左侧可用时向右展开、垂直夹取、submenu 内焦点迁移保持打开、焦点移出后延迟关闭、destroy 后不再响应。
- 修改文件语法检查 PASS；Frozen `src/document/document-model.js` hash 仍为 `d767d9025be05a6f6b87d7cd3527782db1c3303a`。
- Architecture hard gate、全量 Node regression、Browser Contract、生产 Build、Built App regression、证据上传全部 PASS。
- `npm audit --audit-level=low` PASS，未新增生产依赖。

真实 Chromium 首轮验证曾因测试同时混用 synthetic pointerenter 与 focus 状态造成 focus-out 场景非确定性而失败；实现专项当时已 PASS。测试随后改为独立的 focusin→submenu 内焦点迁移→外部 focusout 链，并显式把真实鼠标移到中性区域，修订后独立 Chromium 与完整候选全链均 PASS。该修订没有放宽产品行为或质量门禁。

## 环境限制

当前执行容器没有仓库真实本地 worktree，无法执行本地 `git status` 或本地整仓命令；远端正式基线由不可变 commit SHA 锁定，源码切换在隔离候选分支完成，最终发布仍以 GitHub Actions 全链和正式分支 fast-forward 检查为硬门禁。
