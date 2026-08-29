# Stage 5 / Atomic 5.4 — Recent Files Repository

## 状态

- 当前状态：PASS。
- 基线：`d613ffe5115767880c661dafd87ba9a01f93cccd`（Atomic 5.3 最终 HEAD）。
- 验证候选：`069dd891a10dd93cb74f593725fad01f5773c8ed`，完整候选 run `31311406633` SUCCESS。
- 正式源码/workflow 提交：`dfddedd60158e14405dc3882f7bcdc645b4c0f82`。
- 正式 Stage 5 CI：run `31312167268` SUCCESS。
- Atomic 5.5 尚未实施。

## 任务边界

Atomic 5.4 仅迁移最近文件仓库职责：上限、去重、大小写路径比较、序列化与清空。菜单 DOM、Toast、菜单开关和文件打开编排保持在 UI/应用层，不进入 Repository。

## 实现结果

- 新增 `src/features/documents/infrastructure/recent-files-repository.js`，成为最近文件列表与 `md_editor_recent_files` 持久化的单一权威。
- Repository 保留现有 20 条上限，按规范化路径进行大小写无关去重；重复路径重新加入时提升到首位。
- 读取旧数据时过滤非法项、去重、截断并以既有 `{ path, name, openedAt }` 结构修复写回；合法非数组数据归一为空列表。
- 保留旧版缺省文件名语义：缺失名称时使用路径 basename，无法得到名称时回退 `未命名文件`。
- 存储写失败通过显式 reporter 报告；内存中的已提交最近文件状态不被静默回滚或丢失。
- `clear()` 写入精确空数组；`destroy()` 幂等并使后续状态操作终止。
- 新增 `classic-recent-files-port.js`，只代理 Repository 契约并管理 `#compatibility-business-ports` 上一个临时 scoped property，不复制状态。
- `public/app/core.js` 删除 `RECENT_FILES_KEY`、`MAX_RECENT_FILES`、`recentFiles` 和 `saveRecentFiles()` 等旧权威；仅保留最近文件菜单渲染与 UI 反馈。
- `src/main.js` 负责组合、挂载与销毁 Repository/port，失败路径按现有 Document feature 生命周期逆序清理。
- `src/features/documents/index.js` 继续作为 Stage 5 Documents 公共入口，不在 facade 中堆积实现。

## 保持不变

- 最近文件 localStorage key 仍为 `md_editor_recent_files`。
- 持久化条目结构仍为 `{ path, name, openedAt }`。
- 最近文件最大数量仍为 20。
- 保存/另存为是否进入最近文件的既有用户行为未改变。
- 最近文件菜单 UI、打开文件路径、Toast 文案和菜单关闭行为未改变。
- 无新增 `window.*` 最近文件业务状态权威。
- `src/document/document-model.js` 保持冻结，blob SHA 仍为 `d767d9025be05a6f6b87d7cd3527782db1c3303a`。
- `package.json`、`package-lock.json` 和生产依赖未修改。

## 验证

正式 Stage 5 CI run `31312167268` 在 HEAD `dfddedd60158e14405dc3882f7bcdc645b4c0f82` 上实际通过：

- Stage 4 handoff：99/99；
- Atomic 5.1：7/7；
- Atomic 5.2：8/8；
- Atomic 5.3：11/11；
- Atomic 5.4 Recent Files Repository：7/7；
- Frozen DocumentModel：PASS；
- Architecture：PASS；
- Node regression：42/42；
- Browser Contract：10/10；
- Build：PASS；仅保留既有 Vite chunk-size warning；
- Built App：20/20，其中包含真实应用 Recent Files Repository 上限、大小写无关去重和清空场景；
- evidence artifact：`stage-05-recent-files-31312167268-1`，artifact ID `9037690690`。

依赖准备仍报告既有 4 个 npm audit 项（2 moderate、2 high）；Atomic 5.4 未修改依赖或锁文件，因此本任务未声称修复这些既有项。

## 架构清单

生产模块数量由 250 增至 252：

- `src/features/documents/infrastructure/recent-files-repository.js`
- `src/features/documents/compatibility/classic-recent-files-port.js`

`classic-recent-files-port.js` 是 Stage 5 迁移期临时边界；后续 classic 最近文件调用者退出后应一并删除，不能演化为第二份 Repository。