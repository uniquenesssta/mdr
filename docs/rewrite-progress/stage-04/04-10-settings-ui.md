# Atomic 4.10 — Settings UI 验收记录

## 结论

Atomic 4.10 **PASS**。Settings Dialog 的导航、字段 View、draft 编辑、Apply/Cancel、颜色、自动保存、目录选择和 ModalShell 生命周期已从 classic 静态实现迁入 `src/features/settings/` 的独立 application/ui 模块；4.9 Section descriptors 保持字段归属、顺序、control 与 surface 的单一描述权威。Atomic 4.11 Theme Service **未开始**。

实现提交：`99e1315a397ea96bdaf35dedb9247e8400a26185`（`feat(settings): implement atomic task 4.10 ui`）  
官方 Stage 4 workflow 提交：`9db27aea20e68524044c39f4d1ceeb06d1e03c5c`（`ci(settings): validate atomic task 4.10 ui`）

## 任务边界

本 Atomic 只完成任务书 4.10 的 Settings UI 切换：

- Settings 分类导航；
- Settings Dialog 与字段表单；
- `openSettings / closeSettings / applySettings / switchSettingsPage` 所属 UI 工作流迁移；
- 颜色字段、自动保存间隔字段、默认导出目录字段；
- 字段先写 Store draft，Apply 后提交并同步运行态，Cancel/Escape/Backdrop 丢弃 draft；
- 目录选择继续通过平台能力边界；
- 删除旧静态 Settings Modal 及其 Settings inline handlers。

未实现 Theme Service、系统主题监听或 Theme Store；这些属于 Atomic 4.11。

## 模块职责

新增/启用的主要生产模块：

- `src/features/settings/create-settings-feature.js`：Settings Feature 组合入口；
- `src/features/settings/application/settings-controller.js`：打开、导航、draft 更新、取消、目录选择及生命周期编排；
- `src/features/settings/application/settings-apply-coordinator.js`：Store commit 成功后才执行已提交设置对应的运行态同步；
- `src/features/settings/ui/settings-dialog-view.js`：ModalShell、section 页面、导航、feedback 和字段 View 集合生命周期；
- `src/features/settings/ui/settings-field-view.js`：把单个 Section descriptor 的 `settingId/control/surface` 映射到具体字段 View；
- `src/features/settings/ui/settings-navigation-view.js`：五类 Settings 导航；
- `src/features/settings/ui/color-field-view.js`：颜色输入、预览和重置展示；
- `src/features/settings/ui/autosave-field-view.js`：自动保存间隔与自定义秒数验证；
- `src/features/settings/ui/directory-field-view.js`：默认导出目录展示、选择与清除交互。

这些模块未新增生产依赖。

## Section descriptor 单一权威

4.10 最终实现没有在 Dialog 内重新维护字段顺序和 control。`settings-dialog-view.js` 遍历 `listSettingsSectionDefinitions()`，再遍历 `section.fields`；只有 `surface === 'settings-dialog'` 的 descriptor 被交给 `createSettingsFieldView()`。

结果保持 4.9 契约：

- 15 项 Settings Schema 全覆盖；
- 13 项由 Settings Dialog 渲染；
- `tableVisualEditing`、`codeVisualEditing` 两项继续保持 external；
- section 文件仍然只描述字段，不访问 DOM、Store、Repository、platform 或业务运行态。

`settings-field-view.js` 只负责 descriptor → View 的展示适配；颜色、自动保存和目录继续由各自专用 View 拥有 DOM/监听器，避免把不同职责重新堆回 Dialog。

## Draft、Apply 与 Cancel

运行时状态链保持 4.8 Store 契约：

1. 打开 Settings 时由 Store 建立 draft；
2. 字段变化只调用 draft 更新；
3. Apply 先执行 Store commit / Repository 持久化；
4. commit 成功后，apply coordinator 才同步 theme/language/layout/sidebar/editor/toolbar/performance 等既有运行态入口；
5. 持久化失败时不把失败 draft 伪装成 committed；
6. Cancel、Escape、Backdrop 均丢弃 draft，不执行 Settings 持久化和运行态应用。

目录选择由 controller 调用平台 dialogs 能力，UI View 不直接访问 Tauri、window 或 storage。

## ModalShell 与旧 UI 切换

旧 `public/compatibility/business-content.html` 中的静态 `#settings-modal` 已删除；`src/ui/compatibility/mount-modal-shells.js` 不再拥有 Settings Modal。Settings Feature 创建并拥有自己的 ModalShell 生命周期。

实现验证中 Built App 首次暴露真实缺陷：`SettingsDialogView.open(options)` 曾错误调用 `modal.open(options)`，把 options 当成 ModalShell content，导致：

`TypeError: Modal content must be a DOM node, an iterable of DOM nodes, or null.`

最终修复为 `modal.open(null, options)`，并增加结构回归断言。该缺陷未进入主分支实现提交之前即被 clean runner 阻断。

## Inline event 与 compatibility 边界

Settings 静态 UI 退出后，相应 inline handlers 从 architecture baseline 删除；没有增加新白名单或新豁免。迁移包括旧的 Settings open/close/apply、五类 page switch、颜色 reset/custom、自动保存自定义间隔、目录选择/清除等 handler。

当前 architecture baseline inline-event 实例总数从 **176 降至 159**。原 Settings 菜单中的 `closeAppMenus()` 副作用迁入 `public/app/events.js` 的 scoped listener，HTML 入口只保留 `data-settings-open`，没有新增 Settings inline handler。

Browser compatibility contract 也同步到新的所有权：仅挂载 compatibility business port 时不再要求存在静态 Settings Modal；Settings Modal 只由 Settings Feature 创建。该调整保留了“compatibility port 不拥有 Settings”的断言，并未恢复旧实现。

## 测试与架构门禁

4.10 新增 `tests/unit/settings/settings-ui.test.mjs`，并同步更新 4.8/4.9、ModalShell、SVG、architecture inventory、browser contract 与 Built App 场景。

clean-runner 在进入主分支前依次阻断并修复了以下问题：

- materializer 传输损坏：在执行源码前失败，改为逐字节可校验传输；
- 生成测试中的正则/换行转义错误：未进入产品发布；
- 初始 Dialog 重复维护字段描述：改为 descriptor-driven `settings-field-view.js`；
- architecture baseline 仍要求已删除的 Settings inline handlers：按实际迁移删除旧 baseline 项，没有恢复 inline event；
- Stage 1 当前 inline-event 计数仍为 176：按实际 baseline 同步为 159；
- Browser Contract 仍认为 compatibility port 应拥有静态 Settings Modal：更新为 4.10 新所有权；
- Built App 暴露 ModalShell options/content 参数错误：生产代码修为 `modal.open(null, options)`。

另有一次同候选 Browser Contract 在 Chromium 启动阶段失败：`CDP endpoint did not become ready: fetch failed`，伴随 runner DBus/font 环境输出；未修改代码，重跑同一 job 后 Browser Contract、build、Built App 和发布均通过，因此记录为 runner/Chromium 瞬时故障，不将失败尝试描述为 PASS。

## 官方主分支验证

官方 workflow：`Stage 4 Atomic Verification`  
run：`31270104430`  
最终结论：**SUCCESS**。

实际通过：

- Stage 3 handoff：PASS；
- Atomic 4.1–4.10 定向门禁：PASS；
- Atomic 4.8 Store/Port：15/15 PASS；
- Atomic 4.9 Section Modules：7/7 PASS；
- Atomic 4.10 Settings UI：8/8 PASS；
- locale audit：PASS；
- architecture hard gate：PASS；
- Node regression：42/42 PASS；
- Browser Contract：10/10 PASS；
- `npm run build`：PASS；
- Built App Browser：15/15 PASS；
- evidence upload：PASS。

官方 evidence：

- 名称：`stage-04-settings-ui-31270104430-1`
- Artifact ID：`9025345981`
- SHA256：`749c81fd88724e18832fe3cbb798fb588cb88b9e0667d485394d906188dee123`

artifact 中包含 `04-10-settings-ui-audit.json` 和 Built App responsive shell evidence。

## 未改变的契约与已知限制

本 Atomic 未修改：

- Rust/Tauri command；
- package dependencies、`package-lock.json`、Cargo 依赖；
- Settings Schema 的 15 项数据契约与既有 storage keys；
- 4.8 Repository/Store 的物理持久化与 draft/committed 权威；
- table/code visual editing 的 external surface；
- Theme Service（4.11）。

现有非阻塞环境/工程提示仍存在：npm audit 4 项（2 moderate / 2 high）、Vite >500 kB chunk advisory，以及 GitHub Actions Node runtime deprecation 提示。本 Atomic 未夹带处理这些无关事项。

## 最终判定

Atomic 4.10 满足任务书验收：Settings 分类导航可用，13 个 Dialog 字段由 Section descriptors 驱动，Apply 在成功提交后生效，Cancel/Escape/Backdrop 不产生运行态或持久化副作用，旧 Settings 静态 Modal/inline handlers 已退出，完整官方门禁通过。**Atomic 4.10 PASS；Atomic 4.11 未开始。**
