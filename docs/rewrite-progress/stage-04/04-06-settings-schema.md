# Stage 4 / Atomic Task 4.6 — Settings Schema

## 状态

Atomic 4.6 **PASS**。Settings Schema 已建立为后续 Settings Repository / Store / Sections / UI / Theme Service 的唯一领域契约；Atomic 4.7 尚未开始。

## 任务边界

本节点只建立设置领域定义，不迁移持久化读写、不创建运行时 Settings Store、不迁移 Settings UI，也不实现 Theme Service。

任务书要求每个设置项显式声明：

- legacy persistence `key`；
- `type`；
- `defaultValue`；
- `section`；
- `validation`；
- `serialization`；
- `impactEvent`。

旧 `localStorage` key 必须保持不变。当前 classic `public/app/core.js` / `public/app/editor-tools.js` 继续保留现有运行时职责，直到对应后续 Atomic Task 切换 ownership。

## 实施结构

```text
src/features/settings/
  index.js
  domain/
    settings-defaults.js
    settings-schema.js
    settings-serialization.js
    settings-validation.js
```

### `settings-defaults.js`

独占 15 项设置的不可变默认值。数组型默认值也冻结，避免 schema 通过共享引用产生可变状态。

### `settings-schema.js`

独占 Settings Schema 元数据并导出稳定查询契约：

- `SETTINGS_SCHEMA`
- `SETTING_IDS`
- `SETTING_SECTIONS`
- `SETTINGS_IMPACT_EVENTS`
- `getSettingDefinition(id)`
- `listSettingDefinitions()`

Schema 只依赖公开 `src/i18n/index.js` 的 locale ID 契约以及 settings defaults，不依赖 DOM、storage、Platform、Repository、Store 或 UI。

### `settings-validation.js`

独占纯值验证与规范化：boolean、enum、integer enum/range、optional color、trimmed string、string-array subset。颜色统一规范为小写六位 hex；路径类字符串仅在领域层 trim；toolbar hidden items 必须是允许集合的无重复子集。

### `settings-serialization.js`

独占设置值与历史 `localStorage` 字符串格式之间的纯转换，不执行任何存储 I/O。支持 string、boolean string、integer string、JSON string array；反序列化明确区分 `valid` / `missing` / `invalid`，供 Atomic 4.7 Repository 决定读取策略。可选空值通过 `shouldOmitSettingValue()` 明确表示删除持久化项的语义。

### `index.js`

Settings feature 的唯一公共领域入口。4.6 只导出 domain contract，没有提前创建 Repository、Store、section controller、UI 或 Theme Service。

## 设置清单

| ID | legacy key | 类型 | 默认值 | section | validation / serialization | impact event |
| --- | --- | --- | --- | --- | --- | --- |
| `theme` | `md_editor_theme` | string | `light` | general | light/dark · string | `settings.theme.changed` |
| `language` | `md_editor_language` | string | `zh-CN` | general | 10 locale IDs · string | `settings.language.changed` |
| `layoutMode` | `md_editor_layout_mode` | string | `both` | general | both/hybrid/edit/preview · string | `settings.layout.changed` |
| `sidebarVisible` | `md_editor_sidebar_visible` | boolean | `true` | general | boolean · boolean-string | `settings.sidebar.changed` |
| `autoSaveEnabled` | `md_editor_autosave_enabled` | boolean | `true` | save | boolean · boolean-string | `settings.autosave.changed` |
| `autoSaveDelay` | `md_editor_autosave_delay` | integer | `500` | save | 500–3,600,000 ms · integer-string | `settings.autosave.changed` |
| `editorFontSize` | `md_editor_editor_font_size` | integer | `16` | editor | 14/15/16/18/20 · integer-string | `settings.editor.changed` |
| `editorTextColor` | `md_editor_text_color` | string | empty | editor | optional `#rrggbb` · omit empty | `settings.editor.changed` |
| `activeLineColor` | `md_editor_active_line_color` | string | empty | editor | optional `#rrggbb` · omit empty | `settings.editor.changed` |
| `exportDirectory` | `md_editor_export_directory` | string | empty | save | trimmed string · omit empty | `settings.export.changed` |
| `toolbarVisible` | `md_editor_toolbar_visible` | boolean | `true` | toolbar | boolean · boolean-string | `settings.toolbar.changed` |
| `toolbarHiddenItems` | `md_editor_toolbar_hidden_items` | string[] | `[]` | toolbar | 16 toolbar IDs · JSON array · omit empty | `settings.toolbar.changed` |
| `previewPerformanceMode` | `md_editor_preview_performance_mode` | string | `auto` | performance | auto/virtual/chapter/full · string | `settings.preview.changed` |
| `tableVisualEditing` | `md_editor_table_visual_editing` | boolean | `false` | editor | boolean · boolean-string | `settings.visual-editing.changed` |
| `codeVisualEditing` | `md_editor_code_visual_editing` | boolean | `false` | editor | boolean · boolean-string | `settings.visual-editing.changed` |

`tableVisualEditing` / `codeVisualEditing` 虽未属于当前 Settings dialog 的表单字段，但它们是现有持久化用户偏好，因此纳入同一 schema，避免 4.7 以后继续存在第二套持久化规则。

## 保持不变

- 15 个历史 `localStorage` key 未重命名；
- 当前 classic Settings 读写和用户可观察行为未切换；
- theme 仍只有 light/dark，未提前引入 system theme；
- locale、layout、toolbar、preview performance、visual editing 的当前合法值保持；
- 不迁移 Settings UI；
- 不新增 Repository / Store / Theme Service；
- 不修改 Rust、Tauri command、DTO、持久化结构、生产依赖或 lockfile。

## 测试

新增 `tests/unit/settings/settings-schema.test.mjs`，共 7 项，覆盖：

1. 15 项设置与精确 legacy key；
2. defaults / sections / schema 深冻结；
3. 现有 UI/运行时合法值集合与 autosave 范围；
4. 类型、非法值与规范化；
5. 历史字符串序列化、反序列化与空值 omission；
6. schema key 与 classic `core.js` / `editor-tools.js` 的现存 key 对照；
7. 4.6 领域目录纯度，禁止提前出现 Repository / Store / UI / Theme 实现。

生产模块 inventory 从 206 更新为 **211**；Stage 1 历史 67 模块事实保持不变。

## 实施前/本地验证

在隔离的 4.5 materialized source 上完成：

- Settings Schema：**7/7 PASS**；
- Atomic 4.1–4.6 + documentation targeted chain：**44/44 PASS**；
- 5 个新增生产模块与测试 syntax check：**PASS**；
- root README layout：**PASS**；
- `git diff --check`：**PASS**。

该隔离容器无法执行可信的完整 architecture / Node / browser / build 门禁：父级依赖目录缺少 `marked` 与 Tauri 包，同时 `.vite/deps` 不是 clean runner 生成状态。未把这些环境受阻项描述为通过；完整阶段门禁由 GitHub clean runner 执行。

## GitHub 最终验证

implementation commit：

`19ff52b47b45cf7c0a0d9b1e603e71359163a48b` — `feat(settings): implement atomic task 4.6 schema`

Stage 4 Atomic Verification run `31250136136`：**PASS**（attempt 1）。

Clean runner 实际通过：

- frontend dependency preparation：**PASS**；
- Stage 3 handoff：**PASS**；
- Atomic 4.1：**PASS**；
- Atomic 4.2：**PASS**；
- Atomic 4.3：**PASS**；
- Atomic 4.4：**PASS**；
- Atomic 4.5：**PASS**；
- Atomic 4.6 Settings Schema：**PASS**；
- current locale audit：**PASS**；
- Architecture：**PASS**；
- Node regression：**PASS**；
- Browser Contract：**PASS**；
- Vite build：**PASS**；
- Built App Browser：**PASS**；
- evidence upload：**PASS**。

Evidence：

- artifact：`stage-04-settings-schema-31250136136-1`
- artifact ID：`9019742911`
- artifact size：`6589` bytes
- artifact digest：`sha256:fc1ce58282e34fabc6c39993b376660e601ba5763f187a08bc072bff1ce3d126`
- retention：30 days；到期时间 `2026-09-07T09:15:36Z`

## 结论

Atomic 4.6 已完成并通过 clean GitHub runner 的全部当前硬门禁。Settings 的持久化名称、类型、默认值、分区、验证、序列化和影响事件现在有单一不可变领域契约，而运行时持久化 ownership 仍按阶段边界留给 Atomic 4.7 Settings Repository。
