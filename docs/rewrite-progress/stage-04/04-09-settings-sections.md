# Stage 4 / Atomic Task 4.9 — Settings Section Modules

## 状态

Atomic 4.9 **PASS**。Settings 的 general / editor / save / toolbar / performance 五个 section 已拆为独立、不可变、可单独测试的字段描述模块；Atomic 4.10 Settings UI 尚未开始。

## 任务边界

本节点只负责“描述设置字段”，不迁移 Settings Dialog DOM、不创建导航 View、不接管目录选择、不实现 Apply / Cancel UI 控制器，也不直接调用 editor、preview、export、toolbar、Platform 或 persistence 业务模块。

4.9 必须继续复用已经建立的职责边界：

- Atomic 4.6 `Settings Schema`：key、type、default、section、validation、serialization、impact event 的唯一权威；
- Atomic 4.7 `Settings Repository`：唯一物理持久化 owner；
- Atomic 4.8 `Settings Store`：committed / draft 运行时状态 owner；
- Atomic 4.9 `Section Modules`：只描述字段归属、顺序、控件语义和当前暴露 surface。

## 实施结构

```text
src/features/settings/
  sections/
    settings-section.js
    section-registry.js
    general-settings.js
    editor-settings.js
    save-settings.js
    toolbar-settings.js
    performance-settings.js
```

### `settings-section.js`

纯领域描述校验器。每个字段只保留：

- `settingId`
- `control`
- `surface`

它从 Settings Schema 校验：

- setting 是否存在；
- setting 是否属于当前 section；
- control 是否与 schema validation 类型兼容；
- surface 是否是当前允许值；
- section 内是否存在重复 setting。

该模块不复制合法选项、默认值、序列化规则或持久化 key，因此不会形成第二份设置规则权威。

### 五个 Section Modules

五个 section 文件仅声明字段顺序和控件语义：

| Section | 字段 |
| --- | --- |
| general | `theme`, `language`, `layoutMode`, `sidebarVisible` |
| editor | `editorFontSize`, `editorTextColor`, `activeLineColor`, `tableVisualEditing`, `codeVisualEditing` |
| save | `autoSaveEnabled`, `autoSaveDelay`, `exportDirectory` |
| toolbar | `toolbarVisible`, `toolbarHiddenItems` |
| performance | `previewPerformanceMode` |

当前控件语义包括 `select`、`toggle`、`color`、`duration`、`directory`、`checklist`；合法值和约束仍由 Schema validation 提供。

### `section-registry.js`

独占五个 section 的稳定顺序与查找契约：

- `SETTINGS_SECTION_IDS`
- `SETTINGS_SECTION_DEFINITIONS`
- `getSettingsSectionDefinition(id)`
- `listSettingsSectionDefinitions()`
- 五个具名 section 常量

Registry 在模块加载时验证：

- section 顺序严格为 `general → editor → save → toolbar → performance`；
- 15 个 `SETTING_IDS` 每项恰好出现一次；
- 不允许遗漏或重复字段。

## UI 暴露保持不变

Atomic 4.9 不改变现有可观察 UI：

- 13 项现有 Settings Dialog 字段标记为 `settings-dialog`；
- `tableVisualEditing`、`codeVisualEditing` 两项继续标记为 `external`，仍由既有外部菜单入口呈现；
- 未把这两个 external setting 偷偷加入 Settings Dialog；
- 未创建 4.10 的 `application/` 或 `ui/` 目录。

因此 Section Modules 完整覆盖 15 项 Settings Schema，同时保持当前实际 UI surface 不变。

## 公共入口

`src/features/settings/index.js` 仅增加 section registry 的公开导出，不承载 section 实现，也没有引入 4.10 application/UI 层。

生产模块 inventory 从 214 更新为 **221**，新增的 7 个 production module 均登记为 `settings-section` 职责。

## 历史 4.8 门禁推进

原 Atomic 4.8 测试曾显式要求 `src/features/settings/sections` 不存在，用于证明当时没有提前开始 4.9。

正式进入 4.9 后，这条历史边界测试按 Atomic 顺序只推进一格：

- 允许 `sections/` 存在；
- 继续验证 Repository compatibility bridge 已退出；
- 继续严格禁止 4.10 的 `application/` 和 `ui/`。

没有删除测试，也没有放宽 Store、cancel 零写入、Repository ownership 或生命周期门禁。

## 测试

新增 `tests/unit/settings/settings-sections.test.mjs`，共 **7/7 PASS**，覆盖：

1. 五个 section 的稳定顺序、字段顺序、control 和 surface；
2. 15 项 Schema setting 精确一次覆盖与 section ownership；
3. control 合法性从 Schema validation 派生，不复制 option/default；
4. 13 个 Settings Dialog 字段 + 2 个 external visual-editing toggle；
5. section/registry 深冻结与稳定 lookup；
6. descriptor 与当前 compatibility Settings controls 对照，但不取得 DOM ownership；
7. section 模块纯度，以及 4.10 `application/` / `ui/` 尚未创建。

## 发布过程与失败记录

Atomic 4.9 使用临时 clean-runner 发布分支，只在完整门禁通过后才允许 fast-forward `rewrite/stage-04`。临时分支最终已删除。

发布过程中出现过两次被门禁阻止的尝试，均未写入主分支：

1. 第一次在 materialize 阶段失败：发布器错误使用经过 `trim()` 的 `git status --porcelain` 解析路径，使状态前导空格被破坏，并把未跟踪目录折叠为目录名。修正为 `git diff --name-only` + `git ls-files --others --exclude-standard` 后解决。
2. 第二次在 Atomic 4.8 历史边界测试失败：该测试仍要求 `sections/` 不存在。按上述 4.8→4.9 边界推进后，第三次 clean runner 完整通过。

这两项都不是生产运行时失败；失败记录未被隐藏，也没有通过删除/跳过测试解决。

## Implementation commit

`c475f43907a12fa69d5aa76de94ff3f0c28331b0` — `feat(settings): implement atomic task 4.9 sections`

该 commit 的父提交精确为 Atomic 4.8 最终文档 HEAD：

`b0e8a93291e0081408cc66e93d34caaaa57691ba`

随后官方 workflow 更新：

`0641f5961a74a3e727f7431d6d96c9bccad05452` — `ci(settings): validate atomic task 4.9 sections`

## 官方 GitHub 验证

Stage 4 Atomic Verification run **`31262452798`**：**PASS**。

实际通过：

- dependency preparation：PASS；
- Stage 3 handoff：PASS；
- Atomic 4.1–4.8：PASS；
- Atomic 4.8 Store/Port：**15/15 PASS**；
- Atomic 4.9 Section Modules：**7/7 PASS**；
- current locale audit：PASS；
- Architecture：PASS；
- Node regression：**42/42 PASS**；
- Browser Contract：**10/10 PASS**；
- Vite build：PASS，Vite 7.3.6，**2262 modules transformed**；
- Built App Browser：**14/14 PASS**；
- evidence upload：PASS。

Evidence：

- artifact：`stage-04-settings-sections-31262452798-1`
- artifact ID：`9023178167`
- size：`6602` bytes
- digest：`sha256:a292db037900ae7275d6917a2618f50906f4962ea9c828cf97bcd8f624bd4c0f`
- expires：`2026-09-07T14:39:40Z`

## 临时产物清理

发布 runner 在测试完成后形成 implementation commit 时，曾误把两个本轮生成的 `artifacts/stage-04/*` 诊断文件一并加入 commit。该问题在最终 diff 复核中被发现，未作为完成状态保留。

清理提交：

`1e551ba26dd7d6ef1f4784e786579ea88e5e9981` — `chore: remove atomic 4.9 generated artifacts`

只删除：

- `artifacts/stage-04/04-09-settings-sections-audit.json`
- `artifacts/stage-04/browser-app/responsive-shell-report.json`

没有修改生产源码、测试或行为。Evidence 仍由 GitHub Actions artifact 保存，不在源码仓库遗留构建/诊断产物。

## 已知非阻塞项

本 Atomic 未新增依赖，也未修改 lockfile。Clean runner 仍报告既有环境/依赖提示：

- npm audit：4 vulnerabilities（2 moderate / 2 high）；
- Vite：部分 minified chunks > 500 kB；
- GitHub Actions：checkout/setup-node/upload-artifact 所用 Node 20 action runtime 被 runner 强制到 Node 24 的弃用提示。

本节点不夹带依赖升级、bundle 拆分或 Actions 大版本迁移。

## 结论

Atomic 4.9 已建立五个职责清晰、纯描述、不可变的 Settings Section Modules，并保持 Schema、Repository、Store 三层既有权威不变。字段覆盖完整，现有 UI surface 未改变，Section 不直接调用任何业务模块，临时发布产物已清理。Atomic 4.10 尚未开始。
