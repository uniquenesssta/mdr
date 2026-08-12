# Atomic 6.12 — Recent Files Menu

## 任务边界

本 Atomic 只重写“最近文件菜单”职责：Menu 订阅 Documents 提供的只读最近文件数据并投影菜单，用户操作通过稳定 Menu command 发出。未进入 Atomic 6.13 Window Controller。

## 实际实现

- 新增 `src/features/menu/recent-files-menu-controller.js`：
  - 订阅只读 Recent Files source；
  - 渲染最近文件、空状态与桌面端不可用状态；
  - 点击最近文件发出 `document.open-recent`；
  - 清空发出 `document.clear-recent`；
  - `start()` / `destroy()` 显式管理订阅与 click listener。
- 新增 `src/features/documents/application/recent-files-read-source.js`：只暴露 `snapshot` / `subscribe`，不暴露写操作。
- `RecentFilesRepository` 增加不可变 `snapshot`、revision 与订阅事件；持久化、20 条上限、大小写不敏感去重继续由 Documents 唯一负责。
- classic Recent Files port 收窄为 write-only `add` / `clear`，不再暴露 `load` / `entries`。
- 新增 scoped Menu command port，将动态菜单操作统一路由到 `MenuCommandBindings`。
- `public/app/core.js` 中旧 `loadRecentFiles`、`renderRecentFilesMenu`、`openRecentFile`、`clearRecentFiles` 已删除；仅保留已有打开流程需要的 `addRecentFile()` 写穿透。
- `public/app/bootstrap.js` 不再负责 Recent Files load/render；Repository load 与 Menu controller composition 由模块化入口负责。

## 职责与数据流

```text
Documents RecentFilesRepository
  ├─ Web Storage persistence
  ├─ cap / dedupe / clear
  └─ immutable snapshot + subscribe
          │
          ▼
Documents RecentFilesReadSource (read-only)
          │
          ▼
Menu RecentFilesMenuController
  ├─ DOM projection
  └─ Menu command IDs
          │
          ▼
MenuCommandBindings / compatibility command adapter
  ├─ open recent -> existing native-open command path
  └─ clear recent -> Documents write port
```

Menu 不直接读取 `localStorage`，不持有 Documents 最近文件副本，不执行平台文件 I/O，也不承担 6.11 submenu geometry。

## 保持不变的行为

- 最近文件持久化 key 仍为 `md_editor_recent_files`。
- 最大记录数仍为 20。
- path 去重仍为大小写不敏感。
- 序列化字段仍为 `path` / `name` / `openedAt`。
- classic/native 文件打开成功后仍写入最近文件。
- 非桌面文件系统环境继续显示“桌面版可用”，不暴露不可执行的最近文件项。
- 空记录继续显示“暂无记录”；可用环境中有记录时继续提供“清空记录”。

## 生命周期与异常路径

- Repository subscriber 由 Repository 统一发布并隔离 listener 异常。
- read source 返回幂等 unsubscribe。
- Recent Files Menu Controller 的 `destroy()` 解绑 subscription、delegated click listener 并清理生成 DOM；destroy 后不再响应数据变化。
- command port 不拥有 `MenuCommandBindings` 生命周期；composition root 按逆序销毁。

## 验证

隔离 clean-candidate validator run `31591605996` 已对包含 6.12 实现、测试、README 与本进度记录的候选进行全链验证；最终发布前同一门禁还会对去除 candidate CI 触发项后的最终树再次执行。已确认通过的验证包括：

- Stage 4 handoff：PASS
- Atomic 5.1–5.13 + CR-05：PASS
- Atomic 6.1–6.11：PASS
- Atomic 6.12 unit / architecture / public contract：PASS
- 6.11 与 6.12 real Chromium：PASS
- modified-module parse checks：PASS
- Frozen DocumentModel hash：PASS
- Architecture hard gate：PASS
- full Node regression：PASS
- browser interaction contract：PASS
- build：PASS
- built application regression：PASS
- evidence upload：PASS

正式发布后的 `rewrite/stage-06` workflow 结果作为最终交付验收事实。

## 兼容性与限制

- 未修改 Frozen DocumentModel。
- 未修改最近文件持久化格式或迁移语义。
- 未修改 Rust API、权限、安全策略、配置、环境变量或生产依赖。
- Built App 浏览器回归按 web fallback 验证“桌面版可用”；可用环境下的真实菜单订阅/command 投影由独立 Chromium 6.12 测试覆盖。
- 当前执行环境没有可用本地 Git worktree，因此本地 `git status` 无法执行；远端不可变 SHA、diff 与 GitHub Actions 作为本轮工作区/验证事实来源。
- Atomic 6.13 未开始。
