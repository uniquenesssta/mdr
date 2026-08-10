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

## CR-04 — Stage 4 Taskbook Conformance（2026-08-10）

### 审计与修复

CR-04 以 `agent/plan` 的 Stage 4 任务书为唯一阶段结构基准，并以正式 `rewrite/stage-05@c6b582d1b2f8addccba7151e42a81ef4a0be56da` 为实施基线。运行职责、稳定公共接口、目标文件清单与既有 Stage 4 行为均已核对；未发现需要改变翻译、Settings、Help 或 Theme 运行语义的功能缺陷。

任务书逐文件检查表要求规划文件明确记录职责、允许/禁止依赖、导出 API、状态/副作用以及生命周期或纯模块性质。新增 `tests/architecture/stage-04-taskbook-conformance.test.mjs` 后，初始审计 run `31362726274` 按预期失败并精确暴露 32 个既存声明缺口：13 个 I18n 文件缺完整模块职责头，17 个 Settings 文件已有职责/依赖/导出/副作用说明但缺明确 Lifecycle 声明，2 个 Theme CSS 文件缺对应职责说明；Help 规划文件与 Settings Navigation 已满足要求。

修复只补齐这些模块契约说明，没有改变任何可执行业务语句。I18n Service、Locale Registry、Translation Bindings 和 10 个 locale 数据文件补齐职责边界；17 个 Settings 文件补齐与真实实现一致的生命周期/纯模块声明；light/dark theme 只补充 token-only 样式职责说明。focused run `31362836418` 通过新增 contract test 与 `git diff --check`。

永久 Stage 4 workflow 新增独立 `Verify Stage 4 taskbook file contracts` 步骤；原有 4.1–4.12、locale audit、architecture、Node、Browser Contract、build、Built App 与 evidence 门禁均保留，未删除、跳过或放宽。

### 验证中发现并修正的问题

首次验证 PR 候选的 Stage 4 run `31363101104` 在 Atomic 4.11 Theme 契约处失败：最初将 CSS 职责注释放在文件第一个 selector 之前，破坏了既有 Stage 2 `themes.test.mjs` 对 `light.css` 必须以 `:root {` 开始的硬结构契约。没有修改或放宽该测试；职责说明被移动到第一个 selector block 内顶部，所有 theme token、selector 和运行行为保持不变。

最终候选 `8e51f1eefd91de4461ce855b86c28bbffba8d81c` 的 Stage 5 run `31363240550` 首次在 Browser Contract 启动 Chromium 时出现 `CDP endpoint did not become ready: fetch failed`；在此之前 Stage 4 handoff、5.1–5.8、冻结 DocumentModel、architecture 和 Node 均已通过。仅重跑同一失败 job，未修改源码或门禁；重跑后 Browser Contract、build、Built App 和 evidence 全部通过，因此该次失败记录为 CI Chromium 启动瞬态故障，不作为代码通过结果隐藏。

### 最终候选验证

同一候选 `8e51f1eefd91de4461ce855b86c28bbffba8d81c` 已完成：

- Stage 0 Baseline Verification `31363240519`：PASS；Node、Browser Contract、Build、Built App、`cargo test --locked`、`cargo check --locked`、extended Tauri Linux build、evidence 与 hard gate 全部成功。
- Stage 1 Atomic Verification `31363240522`：PASS。
- Stage 2 Atomic Verification `31363240542`：PASS。
- Stage 3 Atomic Verification `31363240521`：PASS。
- Stage 4 Atomic Verification `31363240558`：PASS；4.1–4.12、新增 taskbook file contract、locale audit、architecture、Node、Browser Contract、build、Built App 与 evidence 全部成功。
- Stage 5 Atomic Verification `31363240550`：失败 job 原样重跑后 PASS。
- Stage 3 Windows Window Automation `31363240507`：PASS；Windows release build、隔离 WebDriver host build、真实原生窗口自动化与 evidence 全部成功。

### 影响与限制

CR-04 没有修改翻译值、Settings key/default/序列化与持久化格式、Help 内容、Theme token 值、Platform、Rust、冻结模型、生产依赖或 lockfile，也没有开始 Stage 5 后续 Atomic Task。当前执行环境没有可用的用户本地 Git checkout，因此无法替用户确认其电脑工作区中的未提交修改；远端实施通过锁定正式 SHA、隔离分支、净 diff 与 GitHub Actions 完成验证。