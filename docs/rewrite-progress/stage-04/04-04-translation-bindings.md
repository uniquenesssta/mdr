# Stage 4 / Atomic Task 4.4 — Translation Bindings

## 状态

Atomic 4.4 **PASS**。implementation commit 与完整 Stage 4 gate 均已通过。Atomic 4.5 Help Content/Controller 尚未开始。

## 任务边界

本节只迁移声明式翻译绑定职责：将 text/title/placeholder/alt/aria-label 的 DOM 翻译从 `public/app/core.js` 的 document-wide 扫描迁移到显式 View-scoped Translation Bindings。

不迁移 Help 正文；`public/help-content.js` 与帮助正文 compatibility 路径继续保留到 4.5。语言持久化 key、I18n Service、locale registry、用户可观察切换行为均保持不变。

## 实施内容

### 1. 新增 `src/i18n/translation-bindings.js`

新增独立职责模块 `createTranslationBindings(i18n, views, options)`，只接收显式 View roots：

- `menu`
- `toolbar`
- `sidebar`
- `editor`
- `preview`
- `status`
- `overlay`

模块在创建时读取这些 View 内现有声明式绑定并缓存，支持：

- `data-i18n` → `textContent`
- `data-i18n-title` → `title`
- `data-i18n-placeholder` → `placeholder`
- `data-i18n-alt` → `alt`
- `data-i18n-aria-label` → `aria-label`

locale change 时只刷新已缓存 binding，不重新扫描 document 或 View。`documentElement.lang` 也由该模块统一刷新。

模块不读取全局 `window` / `document`；`documentElement` 与 View roots 均由 composition root 注入。不同 document 的 View 会被拒绝。

`destroy()` 取消 locale subscription、清空 binding cache，并保持幂等；销毁后的 `refresh()` / `bindingCount` 明确失败。

刷新过程中单个 binding 写入失败不会阻止其余 binding 更新；一个错误直接抛出，多个错误使用 `AggregateError` 汇总，避免静默吞错。

### 2. composition root 负责创建和销毁 Translation Bindings

`src/bootstrap/module-entry.js` 在 UI/content mount 与 I18n Service 创建后创建 Translation Bindings，再挂载 classic I18n port。

销毁顺序保持反向职责清理：classic script → I18n port → Translation Bindings → I18n Service → compatibility content → UI。这样 bindings 的 locale subscription 会在 service destroy 前解除。

### 3. `public/app/core.js` 删除声明式翻译 ownership

删除旧 `applyLanguage()` 中对：

- `[data-i18n]`
- `[data-i18n-title]`
- `[data-i18n-placeholder]`
- `[data-i18n-alt]`

的全局 `document.querySelectorAll()` 扫描。

`setLanguage()` 现在只负责调用 I18n port 切换 locale，并继续写入既有 `md_editor_language` 持久化 key；声明式翻译由 Translation Bindings 独占。

4.5 前仍需保留的动态 classic 消费者集中在 `refreshClassicLocalizedState()`：help body compatibility、折叠按钮标签、View menu、status、count 与 toolbar boundary evaluation。它通过 I18n port subscription 响应 locale change，不形成第二套声明式 binding 实现。

`editor-presentation-badge` 继续使用既有 declarative binding，不再由 classic core 手动重复写入。

### 4. `public/app/bootstrap.js`

启动后的 classic 动态刷新由 `applyLanguage()` 改为 `refreshClassicLocalizedState()`；声明式 DOM 更新已在 composition root 创建 Translation Bindings 时完成。

### 5. I18n public entry 与架构清单

`src/i18n/index.js` 新增导出 `createTranslationBindings`。

生产模块新增：

- `src/i18n/translation-bindings.js`

当前 production module inventory 从 188 更新为 **189**。Stage 1 历史模块事实不修改，仅同步 current inventory 断言与相关职责描述。

## 保持不变

- 10 个 locale 文件与 161 键集合不变；
- I18n Service 仍是 locale state / `t()` / fallback / change event 的唯一运行时权威；
- `helpHtml` 内容与 4.2 compatibility 边界不变；
- `md_editor_language` key 与持久化语义不变；
- 现有 114 个 declarative bindings 保持；
- 不修改 Rust command、DTO 或 Rust 源码；
- 不修改 `package.json`、生产依赖或 lockfile；
- 不实施 Atomic 4.5 Help Content/Controller。

## 测试

新增 `tests/unit/i18n/translation-bindings.test.mjs`，共 7 项，覆盖：

1. explicit Views 内 text/title/placeholder/alt/aria-label；
2. locale change 只刷新缓存 bindings、不重新扫描 Views；
3. destroy 取消 subscription、幂等与 terminal 行为；
4. named View 完整性与 cross-document 拒绝；
5. 无 global `document` / `window` 依赖；
6. binding write failure 继续剩余写入并汇总异常；
7. production integration：composition wiring、destroy 顺序、classic 全局扫描删除、114 个既有 declarative bindings 保持。

4.1–4.3 historical tests 同步为迁移后的当前 ownership 断言，没有放宽 locale key、placeholder、help SHA、registry 或 Service 硬门禁。

## 本地验证

implementation commit 前在 Windows 工作区完成：

- Stage 3 handoff：**6/6 PASS**；
- Atomic 4.1–4.4 i18n targeted suite：**28/28 PASS**；
- documentation layout：**1/1 PASS**；
- Architecture：**PASS**；
- Node regression：**42/42 PASS**；
- Browser Contract：**10/10 PASS**；
- Vite build：**PASS**；存在既有 >500 kB chunk advisory；
- Built App Browser：**12/12 PASS**；
- `git diff --check`：无错误；Windows 工作区仅显示 LF→CRLF 行尾提示。

## 最终验证

implementation commit：

`38fced8a9dd0ee205e00d4cb13bb389e7038ee02` — `feat(i18n): implement atomic task 4.4 bindings`

Stage 4 Atomic Verification run `31247158168`：**PASS**。

远端 clean runner 全部步骤成功：

- frontend dependency preparation：**PASS**；
- Stage 3 handoff：**PASS**；
- Atomic 4.1：**PASS**；
- Atomic 4.2：**PASS**；
- Atomic 4.3：**PASS**；
- Atomic 4.4 Translation Bindings：**PASS**；
- current locale audit：**PASS**；
- Architecture：**PASS**；
- Node regression：**PASS**；
- Browser Contract：**PASS**；
- Vite build：**PASS**；
- Built App Browser：**PASS**；
- evidence upload：**PASS**。

Evidence：

- artifact：`stage-04-translation-bindings-31247158168-1`
- artifact ID：`9018854203`
- artifact size：`6587` bytes
- artifact digest：`sha256:391fd82d8103af4007ee295793baf1235c04b9958e9f2f741ac42adeffe6061a`
- retention：30 days；到期时间 `2026-09-07T07:53:56Z`

## 结论

Atomic 4.4 已完成并通过本地与 clean GitHub runner 的全部当前硬门禁。声明式 DOM 翻译现在只有 Translation Bindings 一个权威 owner，并通过显式 View 边界与生命周期管理消除了 classic document-wide translation scan。Help Content/Controller 仍按阶段边界留给 Atomic 4.5。
