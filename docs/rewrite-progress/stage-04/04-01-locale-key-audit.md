# Stage 4 / Atomic Task 4.1 — 翻译键审计

## 状态

已完成 4.1 实施，Stage 4 全量回归验收进行中；4.2 未开始。当前任务只冻结旧国际化实现的兼容事实，不修正翻译、不拆 locale、不迁移运行时 I18n。

## 实施范围

新增 `scripts/stage-04/locale-key-audit.mjs`，以 `public/i18n.js` 为唯一 locale 数据源，分别承担：

- 在对象求值前读取 locale / key 声明，检测重复 locale 与重复 key，避免 JavaScript 后写覆盖掩盖重复项；
- 运行隔离 VM 获取现有字符串值，不修改生产 locale 对象；
- 提取每个 locale 的键集合与 `{0}` / `{1}` 等占位符签名；
- 识别含 HTML 的翻译值，并冻结长度与 SHA-256 摘要，不复制长帮助正文到测试；
- 扫描 `index.html`、`public/`、`src/` 生产源码中的静态字面量翻译引用；
- 分别记录缺失键、重复键、占位符差异、未知引用、静态字面量未使用键和动态 `t(key)` 调用点。

新增 `tests/unit/i18n/fixtures/locale-key-compatibility.json` 作为 4.1 键兼容夹具。夹具只冻结兼容事实，不把源码行号等易漂移诊断信息作为公共兼容契约；完整引用位置仍保留在 CI 原始审计 evidence。

新增 `tests/unit/i18n/locale-key-audit.test.mjs`，覆盖真实夹具一致性、已知缺失键、占位符、HTML 摘要、动态调用边界，以及合成重复 locale/key、占位符和多种引用形式的检测能力。

新增 `.github/workflows/stage-04-atomic.yml`，4.1 验收顺序为 Stage 3 handoff、4.1 专项测试、原始审计 evidence、架构门禁、Node 回归、Browser Contract、生产构建、Built App Browser 回归和 evidence 上传。

## 当前审计事实

首个真实 GitHub runner 审计 run `31237553339` 已成功生成 evidence：

- locale：10 个：`zh-CN`、`zh-TW`、`en`、`ja`、`ko`、`es`、`fr`、`de`、`ru`、`pt`；
- 联合键：162 个；
- `zh-CN`、`en`：各 162 个键；
- `zh-TW`、`ja`、`ko`、`es`、`fr`、`de`、`ru`、`pt`：各 160 个键；
- 上述 8 个 locale 均缺少 `importFromWeb` 与 `importLocalFile`；本任务只记录，不静默补齐；
- 重复 locale：0；重复 key：0；
- 占位符不一致：0；未知静态引用：0；
- 含 HTML 的键只有 `helpHtml`，每个 locale 的长度与 SHA-256 已冻结；
- 静态字面量审计识别 23 个未使用键；该结果不等同于语义死代码，因为 `public/app/core.js` 仍有 4 个动态 `t(key)` 绑定调用，已在原始 evidence 中单独记录。

## 保持不变

- 未修改 `public/i18n.js` 的任一键、翻译值、locale 顺序或 `helpHtml` 内容；
- 未修改 `public/app/core.js` 的 `t()`、`setLanguage()`、`applyLanguage()` 或语言持久化行为；
- 未创建 `src/i18n/` 生产实现，避免提前实施 4.2/4.3；
- 未修改设置键、默认值、首次帮助语义、Rust、生产依赖或锁文件。

## 验证状态

已完成：

- GitHub runner 原始审计生成与 artifact 上传：PASS（run `31237553339`）。

待完成后才能将 Atomic 4.1 标记 PASS：

- 4.1 专项契约测试；
- Stage 3 handoff；
- architecture；
- Node 回归；
- Browser Contract；
- Vite build；
- Built App Browser；
- 最终 4.1 evidence。

任何硬门禁失败都必须先修复，不进入 4.2。
