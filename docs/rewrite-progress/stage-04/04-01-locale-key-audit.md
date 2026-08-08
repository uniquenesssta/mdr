# Stage 4 / Atomic Task 4.1 — 翻译键审计

## 状态

Atomic Task 4.1 **PASS**。当前任务只冻结旧国际化实现的兼容事实，不修正翻译、不拆 locale、不迁移运行时 I18n；4.2 未开始。

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

## 审计基线

真实审计确认：

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

## 最终验证

Clean implementation commit：`45b29c652c9b42aa7b6f13b15b9803ea34d5fe05`。

Stage 4 Atomic Verification run `31237882133`：**PASS**。

- Stage 3 handoff：**6/6 passed**；
- Atomic 4.1 专项：**7/7 passed**；
- locale 原始审计生成：**passed**；
- `npm run verify:architecture`：**passed**；
- Node regression：**42/42 passed**；
- Browser Contract：**10/10 passed**；
- Vite production build：**passed**，2214 modules transformed；保留既有 >500 kB chunk-size advisory；
- Built App Browser regression：**12/12 passed**；
- evidence artifact：`stage-04-locale-audit-31237882133-1`，artifact ID `9016058686`，上传成功。

首个独立原始审计 run `31237553339` 同样成功，用于生成最初兼容基线。

## 已知限制 / 非 4.1 变更

4.1 没有修改 `package.json` 或 `package-lock.json`，因此本次 Stage 4 workflow 没有新增 `npm audit` 硬门禁。clean runner 的 `deps:prepare` 安装输出仍报告当前仓库依赖基线存在 4 项 advisory（2 moderate、2 high）；这不是 4.1 引入的变化。用户本地受保护的 lockfile 之前已执行安全更新并得到 `npm audit` 0 vulnerabilities，但该本地 lockfile 内容未由本任务覆盖或提交。

本任务未发现新的运行时、架构或浏览器回归。Atomic 4.1 完成后才允许进入 4.2。
