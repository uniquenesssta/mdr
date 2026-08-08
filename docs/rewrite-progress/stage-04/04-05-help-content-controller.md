# Stage 4 / Atomic Task 4.5 — Help Content/Controller

## 状态

Atomic 4.5 **PASS**。Help Content/Controller 已从 classic compatibility 路径迁移为独立 Feature，并通过本地与 GitHub Stage 4 完整硬门禁。Atomic 4.6 尚未开始。

## 任务边界

本节只迁移 Help 长正文、首次显示、导航、语言刷新和 Help ModalShell 生命周期，不扩展到其他 classic feature。

目标是结束 4.2–4.4 为兼容而保留的临时 Help 内容/控制链，使 Help 成为职责独立、可销毁、可验证的正式 Feature，同时保持既有帮助正文、持久化 key 和用户可观察行为。

## 实施内容

### 1. `src/features/help/` 成为正式 Help Feature

新增按职责拆分的 Help 模块：

- `create-help-feature.js`：Feature composition 与构造失败回滚；
- `help-controller.js`：首次显示、打开/关闭、导航、locale change 与持久化协调；
- `help-state.js`：六个稳定 Help page 的规范化导航状态；
- `help-content-registry.js`：10 语言长正文注册、校验与 fallback；
- `index.js`：Help Feature 公共入口；
- `compatibility/classic-help-port.js`：仅为剩余 classic 启动调用提供 scoped port；
- `ui/help-dialog-view.js`：Help dialog DOM、ModalShell、正文渲染与可访问性；
- `ui/help-navigation-view.js`：Help 页签 DOM、active 状态与点击生命周期；
- `content/help.*.js`：10 个语言的独立长帮助正文模块。

模块头契约明确公共 API、允许依赖、状态/副作用与生命周期，避免把整个 Help 功能重新堆回单文件。

### 2. 长帮助正文从临时 classic 内容源迁移

删除 `public/help-content.js`。

原有 10 语言帮助 HTML 按语言迁入：

- de
- en
- es
- fr
- ja
- ko
- pt
- ru
- zh-CN
- zh-TW

迁移不是改写文案。Atomic 4.2 冻结的历史帮助 HTML SHA 在迁移后继续逐语言保持一致，10/10 compatibility hash 不变。

短 UI 文本仍由既有 I18n Service / Translation Bindings 负责，长正文不重新塞回 short-text locale registry，保持内容与翻译键的职责分离。

### 3. Help Controller 独占行为与状态

新 Help Controller 负责：

- `md_editor_help_shown` 首次显示语义；
- Help 打开与关闭；
- 六页导航；
- locale change 后保持当前 active page 并刷新正文；
- 关闭后的 shown-state 持久化；
- menu trigger；
- subscription / event listener 清理；
- terminal destroy。

首次显示语义保持历史行为：首次自动显示后，只有关闭 Help 才写入已显示状态。

构造阶段如果 locale subscription 已成功、但后续 menu listener 安装失败，Controller 会回滚已登记资源，避免留下悬挂订阅。

### 4. UI / ModalShell ownership 收口

`help-modal` 从 `public/compatibility/business-content.html` 和 compatibility ModalShell registry 移除。

Help dialog 现在只由 `HelpDialogView` 创建、挂载和销毁，compatibility ModalShell 数量由九个收缩为剩余八个，不存在第二套 Help modal lifecycle。

Help 的 `icon-book` 与 `icon-close` 继续使用统一 `createIconView()` / external sprite contract。Atomic 2.3 SVG 门禁同步迁移为：

- compatibility HTML 静态 sprite 引用从 50 收缩为 48；
- HelpDialogView 必须通过 `createIconView()` 使用两个 Help 图标；
- HelpDialogView 禁止重新写入 `<svg>` / `<use>` 或直接 sprite geometry。

因此测试变化不是放宽图标门禁，而是把所有权断言迁移到新的正式 owner。

### 5. classic Help authority 删除

`public/app/core.js`、`public/app/bootstrap.js`、`public/app/editor-tools.js` 中原 Help 权威实现与临时调用链已移除或改为 scoped Help port。

classic 层不再拥有 `openHelp` / `closeHelp` / `switchHelpPage` 的第二套状态机，也不再拥有长帮助正文。

`src/bootstrap/module-entry.js` 在 Translation Bindings 前创建 Help Feature，使 Help 自己创建的 declarative UI 进入既有 View-scoped translation discovery；销毁时按逆序释放 Help port、Help Feature、Translation Bindings 与 I18n Service。

### 6. 架构与审计清单同步

同步更新：

- architecture source analysis；
- production module inventory；
- architecture baseline；
- Stage 4 locale audit；
- Stage 1 handoff/current inventory 断言；
- browser E2E contract；
- built-app browser regression；
- ModalShell contract；
- I18n / Translation Bindings historical ownership assertions。

所有更新均跟随真实责任迁移，没有新增生产依赖，也没有通过删除或弱化失败测试掩盖问题。

## 保持不变

- 10 语言帮助正文的历史内容与冻结 SHA 不变；
- locale short-text registry 继续只保存短文本；
- `md_editor_help_shown` key 与首次显示语义不变；
- I18n Service 的 locale state / `t()` / fallback contract 不变；
- Translation Bindings 继续是 declarative text/title/placeholder/alt/aria-label 的唯一 owner；
- Help 外其他 compatibility modal 行为不变；
- 不修改 Rust command、DTO、持久化或 Rust 源码；
- 不修改 `package.json`、生产依赖或 lockfile；
- 不实施 Atomic 4.6。

## 本地验证

在 Windows 工作区、implementation commit 前完成：

- Stage 1 handoff：**4/4 PASS**；
- Atomic 4.1–4.5 i18n/help targeted suite：**36/36 PASS**；
- ModalShell：**6/6 PASS**；
- SVG sprite ownership：**3/3 PASS**；
- Architecture：**PASS**；
- Node regression：**42/42 PASS**；
- Browser Contract：**10/10 PASS**；
- Vite build：**PASS**；仅存在既有 >500 kB chunk advisory；
- Built App Browser：**12/12 PASS**，其中 Help Feature 首次显示、导航和 scoped lifecycle 实际通过；
- `git diff --check` / `git diff --cached --check`：无错误；Windows 工作区仅显示 LF→CRLF 行尾提示。

本地验证期间曾发现 Atomic 2.3 历史 SVG 测试仍冻结 compatibility 静态引用数量 50。Help modal 被正确迁出 compatibility HTML 后实际为 48；确认缺少的两个静态引用正是已由 `HelpDialogView` 的 `createIconView()` 接管的 `icon-book` / `icon-close` 后，测试改为同时验证 48 个 compatibility 引用与新的 Help icon owner，随后 SVG 3/3、Node 42/42 均通过。

## 最终验证

implementation commit：

`67dd4c7bb0aa8ecaa63f80e2701d72bdd99ac0a8` — `feat(help): implement atomic task 4.5`

Stage 4 Atomic Verification run `31248871960`：

### Attempt 1

**FAIL**，唯一失败步骤为 Browser Contract。

此前步骤全部成功：

- frontend dependency preparation：PASS；
- Stage 3 handoff：PASS；
- Atomic 4.1：PASS；
- Atomic 4.2：PASS；
- Atomic 4.3：PASS；
- Atomic 4.4：PASS；
- Atomic 4.5 Help Content/Controller：PASS；
- current locale audit：PASS；
- Architecture：PASS；
- Node regression：PASS。

Browser Contract 在启动 Chromium 时失败：

`CDP endpoint did not become ready: fetch failed`

runner 同时记录 DBus 与 font mtime 环境错误。由于该步骤失败，build、Built App Browser 和 evidence 在 attempt 1 被跳过。该失败未描述为通过。

### Attempt 2 / failed-job rerun

对同一 `67dd4c7`、无任何代码变更重跑失败 job 后：**PASS**。

远端 clean runner 全部步骤成功：

- frontend dependency preparation：**PASS**；
- Stage 3 handoff：**PASS**；
- Atomic 4.1：**PASS**；
- Atomic 4.2：**PASS**；
- Atomic 4.3：**PASS**；
- Atomic 4.4 Translation Bindings：**PASS**；
- Atomic 4.5 Help Content/Controller：**PASS**；
- current locale audit：**PASS**；
- Architecture：**PASS**；
- Node regression：**PASS**；
- Browser Contract：**PASS**；
- Vite build：**PASS**；
- Built App Browser：**PASS**；
- evidence upload：**PASS**。

第一轮 CDP 启动失败因此归类为 runner/browser 瞬态故障；同一代码提交在第二次 job 尝试完整通过。

Evidence：

- artifact：`stage-04-help-content-31248871960-2`
- artifact ID：`9019377756`
- artifact size：`6583` bytes
- artifact digest：`sha256:d02efe3348e9a213ba31b04f5acbcd86ad07da66f584a1626ffd291aee226a56`
- retention：30 days
- expires：`2026-09-07T08:41:37Z`

## 结论

Atomic 4.5 已完成并通过本地与 GitHub clean runner 的当前全部硬门禁。

Help 现在拥有独立的 Content Registry、State、Controller、Dialog View、Navigation View 与 scoped compatibility port；长正文与短文本 i18n 已分离，Help ModalShell 与图标均有唯一 owner，classic Help 权威实现已删除，生命周期与异常回滚路径均有专项验证。

Atomic 4.6 尚未开始。
