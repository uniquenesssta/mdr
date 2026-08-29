# Stage 4 / Atomic Task 4.2 — Locale 拆分与注册表

## 状态

Atomic 4.2 **PASS**。4.2 clean implementation commit 已完整通过 Stage 4 gate；4.3 尚未开始。

## 任务边界

本节只完成 Locale 数据职责拆分、统一注册与旧 classic 调用兼容切换，不提前实现 4.3 的 I18n Service，也不提前实施 4.5 的 Help Controller/Help Content 正式模块。

## 实施内容

### 1. 删除单体 `public/i18n.js`

旧文件同时承载 10 个语言的短文本和长篇 `helpHtml`。4.2 删除该单体实现，不保留第二份 locale 权威。

### 2. 每语言一个短文本模块

新增 `src/i18n/locales/`，包含：

- `zh-CN.js`
- `zh-TW.js`
- `en.js`
- `ja.js`
- `ko.js`
- `es.js`
- `fr.js`
- `de.js`
- `ru.js`
- `pt.js`

每个模块只导出冻结的短文本字典，不包含 `helpHtml` 或其他长 HTML 内容。

### 3. 精确保持旧 fallback 可观察行为

4.1 审计确认 `zh-TW`、`ja`、`ko`、`es`、`fr`、`de`、`ru`、`pt` 均缺 `importFromWeb` 与 `importLocalFile`。旧 `t()` 在缺键时会使用 `zh-CN` 值。

4.2 没有新增翻译，而是把这两个既有 fallback 结果显式物化到上述 8 个 locale，使全部 locale 统一为 161 个短文本键，同时保持旧运行时用户可见文本不变。

`tests/unit/i18n/fixtures/locale-split-compatibility.json` 冻结：

- 迁移前每个 locale 的短文本 SHA-256；
- 每个 locale 实际物化的 fallback 键；
- 迁移后短文本 SHA-256；
- 每个 locale 原 `helpHtml` 的 SHA-256；
- 161 键公共键面的 SHA-256。

测试会在移除物化键后重新计算迁移前字典摘要，因此除已知两个 fallback 键外，其余短文本必须逐值保持兼容。

### 4. 新增 Locale Registry

`src/i18n/locale-registry.js` 成为短文本 locale 的唯一注册权威，负责：

- 注册 10 个 locale；
- 默认 locale 固定为 `zh-CN`；
- 拒绝重复 locale；
- 校验每个值必须为字符串；
- 拒绝 locale 中出现帮助/内容 HTML；
- 以默认 locale 为基准校验精确键集合；
- 校验 `{0}`、`{1}` 等占位符签名一致；
- 暴露冻结的 `localeIds`、`keys`、`has()`、`get()`。

`src/i18n/index.js` 是 Stage 4 国际化数据层的公共入口。

### 5. classic 调用兼容边界

由于 4.3 才迁移 `t()`、`setLanguage()`、`applyLanguage()` 的服务职责，4.2 新增 `src/i18n/compatibility/classic-locale-port.js`：

- 只挂载到既有隐藏 `#compatibility-business-ports`；
- 属性为 `markdownEditorLocalePort`；
- 仅暴露 `defaultLocale`、`hasLocale()`、`getLocale()`；
- 不向 `window`/`globalThis` 发布新 I18n facade；
- 只读、可销毁、销毁后终止使用；
- 后续 classic 国际化调用迁走后可删除。

`src/bootstrap/module-entry.js` 在加载应用前先挂载该 port，销毁启动资源时同步销毁。

`public/app/core.js` 的现有 `t()` / `setLanguage()` 已切换为从该 scoped port 读取 locale，不再使用 `i18n[currentLang]`。

### 6. `helpHtml` 从 Locale 中剥离

为满足“locale 只能放短文本”，原 10 个 `helpHtml` 按字节兼容迁出到 `public/help-content.js`。

这不是 4.5 的最终 Help 架构：它只是现有 classic Help 行为的临时兼容数据边界，挂载为 `markdownEditorHelpContent` 到同一个隐藏 compatibility host。`core.js` 当前仍按旧时机将其写入非分类帮助区域；正式 Help Content/Controller 继续留给 4.5。

所有 `helpHtml` 的 SHA-256 与 4.1 夹具完全一致。

### 7. 当前 locale 审计升级

`scripts/stage-04/locale-key-audit.mjs` 从旧 `public/i18n.js` 数据源切换到新的 split registry：

- 当前 schemaVersion 为 2；
- 当前源为 `src/i18n/locale-registry.js`；
- 检查 10 个 locale 的 161 键；
- 检查重复 key、缺失键、占位符差异和 HTML 泄漏；
- 继续扫描生产静态翻译引用及动态 `t(key)`；
- `helpContent` 作为独立证据记录长度与 SHA，而不再算 locale HTML 内容。

4.1 的历史兼容夹具没有重写；原 162 联合键、8 locale 缺键和 `helpHtml` 摘要仍保留为迁移前证据。

### 8. 架构追踪

生产模块清单由 174 更新为 187：删除 `public/i18n.js`，新增 10 个 locale 模块、registry、public entry、classic locale port 和临时 help content。

Stage 1 历史计数不变，只更新“当前生产模块数”。

架构 exact baseline 把旧动态 classic script `public/i18n.js` 替换为 `public/help-content.js`。同时 `scripts/architecture/source-analysis.mjs` 增强为显式识别 `/help-content.js`，确保这个 4.5 前的遗留 classic help 依赖仍被硬门禁追踪；没有增加通配豁免，也没有放宽 classic-script 检查。

## 保持不变

- 不修改 Rust command、DTO 或 Rust 源码；
- 不修改 `package.json`、生产依赖或 lockfile；
- 不改变 locale 顺序与默认语言；
- 不改变用户已有语言持久化键；
- 不重新翻译现有字符串；
- 不提前实现 4.3 I18n Service；
- 不提前实现 4.5 Help Controller；
- 不把帮助 HTML 塞回任何 locale 文件。

## 测试

`tests/unit/i18n/locale-key-audit.test.mjs` 保留 4.1 历史契约，共 7 项。

新增 `tests/unit/i18n/locale-registry.test.mjs`，共 7 项，覆盖：

1. 十语言冻结短文本字典与统一 161 键；
2. fallback 物化精确性与迁移前摘要兼容；
3. Help HTML 独立且 SHA 兼容；
4. Registry 对 duplicate/key drift/placeholder drift/HTML/non-string/missing default 的拒绝语义；
5. classic locale port 的 scope/read-only/destroy 生命周期；
6. bootstrap/core 只通过明确 locale/help compatibility API；
7. 当前 split audit 无 duplicate/missing/placeholder/unknown reference。

实施中曾出现一个测试误报：Help 英文自然语言包含 `window.`，旧断言 `/window\./` 误判为全局 API。只将测试收紧为真正禁止的 `window.markdownEditor*` / `window[...]`，生产实现未改。

架构初次验收也发现 Stage 1 动态 classic-script 扫描器只识别 `/app/*.js` 和 `/i18n.js`，无法观察新的 `/help-content.js`。最终修复是扩展扫描器明确识别该路径，而不是删除 baseline 或增加豁免。

## 候选验证

候选实现 HEAD `aa2a6f08876cf8861b63fd8ddd013adf4da9ab65`，Stage 4 run `31240232849`：

- Stage 3 handoff：6/6 PASS；
- Atomic 4.1 历史契约：7/7 PASS；
- Atomic 4.2 专项：7/7 PASS；
- 当前 4.2 locale audit：PASS；
- Architecture：PASS；
- Node regression：42/42 PASS；
- Browser Contract：10/10 PASS；
- Vite build：PASS；存在既有 >500 kB chunk advisory；
- Built App Browser：12/12 PASS；
- evidence artifact：`stage-04-locale-split-31240232849-1`，artifact ID `9016775936`，上传成功。

## 最终 clean 验收

正式 implementation commit：`a16ca6e3c8239facce7aca01d93569308251b4e4`，直接继承 4.1 验收提交 `24d1db73b9b7ce9ef44024057c06729789495f4b`，相对基线只有 1 个 Atomic 4.2 提交。

Stage 4 clean run `31240400556`：

- Stage 3 handoff：PASS；
- Atomic 4.1 历史契约：7/7 PASS；
- Atomic 4.2 专项：7/7 PASS；
- 当前 4.2 locale audit：PASS；
- Architecture：PASS；
- Node regression：42/42 PASS；
- Browser Contract：10/10 PASS；
- Vite build：PASS；既有 >500 kB chunk advisory 仍为非失败提示；
- Built App Browser：12/12 PASS；
- Atomic 4.2 evidence：上传成功。

GitHub runner 的 `deps:prepare` 继续报告 committed dependency baseline 的 4 个既有 advisory（2 moderate、2 high）。4.2 未修改依赖或 lockfile；本任务未把用户另一工作区中受保护的 lockfile 变更带入 Stage 4。

4.2 无已知硬验证缺口。Atomic Task 4.2 已完成；4.3 只有在用户明确开始后才推进。
