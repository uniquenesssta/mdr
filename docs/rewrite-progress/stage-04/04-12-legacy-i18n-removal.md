# Stage 4 / Atomic Task 4.12：删除旧 I18n 实现

## 状态

- 当前状态：PASS。
- 基线：`49019648765b167a1561f7cc5e344c63a119da65`（Atomic 4.11 最终 HEAD）。
- 受控 clean-runner：GitHub Actions run `31300176775`。
- 本节点为 Stage 4 最后一个 Atomic Task；Stage 4 已完成。

## 任务边界

本节点只完成旧国际化实现退役，不新增语言、不改翻译文案、不改设置 key/default/persistence。`public/i18n.js` 已在 Atomic 4.2 删除，本节点验证该删除仍成立，并清除仍留在 classic `core.js` / `bootstrap.js` 的语言状态应用职责。

## 实施结果

### Settings Locale Controller

新增 `src/i18n/settings-locale-controller.js`，职责仅为消费 composition root 注入的已提交 Settings 事件：只有 `changedIds` 包含 `language` 时才把 committed snapshot 的 language 委托给 I18n Service `setLocale()`。Settings Store 已在提交前完成 schema 验证，I18n Service 继续以 locale registry 校验 locale；Controller 不反向导入 Settings Schema，从而避免 Settings Schema → I18n Registry → I18n facade 的循环依赖。Controller 只拥有一条事件 listener 生命周期；destroy 解绑，构造期部分安装失败时回滚。它不拥有 locale 值、翻译字典、DOM 文本、localStorage 或 Settings 持久化。

### 启动 locale 所有权

`src/bootstrap/module-entry.js` 先创建 Settings Repository/Store，再用 `settingsStore.get('language')` 作为 I18n Service 的 `initialLocale`。因此已保存语言在正式 composition root 内恢复，不再需要 classic bootstrap 二次写入 locale。Settings Locale Controller 接收同一 composition root 注入的 `SETTINGS_CHANGED_EVENT`，消费后续已提交 Settings 变化，并纳入显式逆序销毁。

### 旧实现删除

删除：

- `public/app/core.js::setLanguage()`；
- core SettingsChanged 路径中的 `setLanguage(applied.language, false)`；
- `public/app/bootstrap.js` 的 `savedLang` / `coreI18nPort.setLocale(savedLang)` 启动恢复。

继续确认：

- `public/i18n.js` 不存在；
- 生产启动链不存在全局 `i18n`；
- 不存在 `currentLang`；
- classic core 仍通过 scoped `markdownEditorI18nPort.t()` 消费动态翻译，但不再拥有 locale 状态或 Settings→locale 应用职责。

### 架构与持续验证

- I18n 公共入口新增 Settings Locale Controller 导出；
- 生产模块清单从 233 增至 234；
- 正式 Stage 4 workflow 新增 Atomic 4.12 专项；
- Built App 增加真实 Settings language 提交场景，验证 Store 持久化、I18n locale、`documentElement.lang`、动态 classic 文本以及不存在 `window.i18n/currentLang/setLanguage`。

## 保持不变

- 10 个 locale 与 161 个短文本键；
- I18n Service 的 locale/t/fallback contract；
- Translation Bindings 的 114 个声明式绑定 ownership；
- Help 长正文及首次显示语义；
- `md_editor_language` key、默认值与序列化格式；
- Settings Apply/Cancel 语义；
- Theme、编辑器、preview/model、Rust/Tauri 接口和数据格式；
- 生产依赖与 lockfile。

## 验证

同一最终候选在受控 clean-runner 中执行并通过：Stage 3 handoff、Atomic 4.1–4.11 历史专项、Atomic 4.12 Settings Locale Controller/legacy removal 专项、locale audit、architecture hard gate、完整 Node regression、Browser Contract、production build、Built App Browser（包含真实语言设置提交与无 legacy globals 断言）、documentation layout 与 diff check。

## 已知限制

- 剩余 classic 动态 UI 文本仍通过 scoped I18n compatibility port 调用 `t()`；它们是翻译消费者，不拥有 locale 状态。后续 classic feature 迁移时该 compatibility port 可随最后消费者一起删除。
- 本节点不迁移其它 classic feature，也不提前开始下一阶段。
