# Stage 4 / Atomic Task 4.3 — I18n Service

## 状态

Atomic 4.3 已完成实施，等待 clean implementation commit 的完整 Stage 4 gate 复验。4.4 Translation Bindings 与 4.5 Help Content/Controller 尚未开始。

## 任务边界

本节只迁移国际化运行时服务职责：locale 状态、`t()`、参数格式化、fallback、切换事件和生命周期。DOM 文本绑定仍保留为 4.4 前的 classic 兼容消费者；帮助正文继续保留在 4.2 的临时 `public/help-content.js`，等待 4.5 正式迁移。

I18n Service 明确禁止读取 `document`、`window`、`localStorage`，也不执行 `querySelector` / `querySelectorAll` 或全 DOM 扫描。

## 实施内容

### 1. 新增 `src/i18n/i18n-service.js`

新增显式实例 `createI18nService(registry, options)`，由服务独占：

- 当前 locale 状态；
- 默认 locale；
- `t(key, ...args)` 翻译查询；
- `{0}`、`{1}` 等参数格式化；
- 当前 locale → 默认 locale → key 的 fallback；
- `setLocale(locale)` 规范化与切换；
- locale change 订阅；
- `destroy()` 终止生命周期。

无效 locale 保持旧 `setLanguage()` 语义：回退到 `zh-CN`。同 locale 重复设置不会重复发布事件。

切换事件为冻结对象：`{ locale, previousLocale }`。单个 listener 异常会继续完成其他 listener 投递且不回滚已经提交的 locale 状态；多个 listener 同时失败时使用 `AggregateError` 汇总，避免静默吞错。

销毁后 `locale`、`t()`、`setLocale()`、`subscribe()` 均进入 terminal 状态；重复 `destroy()` 幂等。

### 2. classic compatibility bridge 从“字典桥”升级为“服务桥”

删除：

- `src/i18n/compatibility/classic-locale-port.js`
- `markdownEditorLocalePort`
- classic caller 的 `getLocale()` / `hasLocale()` 原始字典访问

新增：

- `src/i18n/compatibility/classic-i18n-port.js`
- hidden compatibility host 上的 `markdownEditorI18nPort`

bridge 只暴露：

- `locale`
- `defaultLocale`
- `t()`
- `setLocale()`
- `subscribe()`

它不向 `window` / `globalThis` 发布 I18n facade，也不暴露 locale registry 或字典对象。bridge 自己跟踪通过它创建的 subscriptions；destroy 时先取消订阅再卸载 host property，之后所有调用明确失败。

### 3. composition root 创建唯一 I18n Service

`src/bootstrap/module-entry.js` 现在按以下顺序启动：

1. 创建 App Shell；
2. 挂载 compatibility business content；
3. 创建唯一 `I18n Service`；
4. 在 existing hidden ports host 上挂载 classic I18n bridge；
5. 加载 4.5 前的 legacy help content；
6. 导入当前 application。

启动失败或显式 destroy 时按反向顺序清理：classic script → I18n port → I18n Service → compatibility content → UI。I18n port 与 service 均为独立可销毁职责。

### 4. classic `core.js` 删除翻译算法和 locale state ownership

`public/app/core.js` 不再保存 `let currentLang`，也不再读取 locale registry / dictionary。

原 `t()` 只保留 classic lexical compatibility 入口，内部一行委托 `coreI18nPort.t(key, ...args)`；fallback 和格式化算法只有 I18n Service 一份权威实现。

原 `setLanguage()` 现在只承担 4.6 前的设置持久化兼容职责：

1. 调用 `coreI18nPort.setLocale(lang)`；
2. 将服务返回的 resolved locale 写回既有 `md_editor_language` key；
3. 调用旧 `applyLanguage()` compatibility binding。

`applyLanguage()` 仍执行 `[data-i18n*]` 全 DOM 扫描，但它不属于 I18n Service，也不拥有 locale 状态；当前 locale 每次从 `coreI18nPort.locale` 获取。该扫描明确留给 Atomic 4.4 删除，4.3 不提前重写 Translation Bindings。

设置弹窗语言值也改为读取 `coreI18nPort.locale`。

### 5. 修复已保存语言的启动回归

4.2 删除 `public/i18n.js` 后，`public/app/bootstrap.js` 仍残留：

```text
i18n[savedLang]
currentLang = savedLang
```

没有保存语言的测试路径因短路不会触发，但已有 `md_editor_language` 用户可能在启动时访问已删除的 `i18n` 全局。

4.3 将启动恢复改为：存在 saved locale 时调用 `coreI18nPort.setLocale(savedLang)`。无效保存值由 Service 按旧行为解析为默认 `zh-CN`；持久化 key 和启动后 `applyLanguage()` 时序保持不变。

### 6. `src/i18n/index.js`

公共入口现在导出：

- locale registry；
- `createI18nService`；
- `mountClassicI18nPort`。

Locale 数据仍只由 4.2 registry 掌权；Service 不直接 import 任一 `locales/*.js`。

### 7. 架构清单

生产模块净变化：

- + `src/i18n/i18n-service.js`
- + `src/i18n/compatibility/classic-i18n-port.js`
- - `src/i18n/compatibility/classic-locale-port.js`

因此当前生产模块数由 187 更新为 **188**。Stage 1 历史 67 模块事实不修改，仅更新 current inventory 断言。

`production-modules.json` 同步记录新的 service/compatibility 职责，并更新 I18n public entry / bootstrap 的当前职责说明。

## 保持不变

- 10 个 locale 文件与 161 键集合不变；
- 4.2 fallback 物化值不变；
- `helpHtml` 内容与 SHA 不变；
- `md_editor_language` 持久化 key 不变；
- 语言设置 UI 与用户可观察切换行为不变；
- 不修改 Rust command、DTO 或 Rust 源码；
- 不修改 `package.json`、生产依赖或 lockfile；
- 不实施 4.4 Translation Bindings；
- 不实施 4.5 Help Content/Controller。

## 测试

新增 `tests/unit/i18n/i18n-service.test.mjs`，覆盖 7 类契约：

1. locale state、initial/default/invalid normalization；
2. `t()` 参数替换、默认 fallback、key fallback；
3. locale change 事件、不可变 event、重复切换不发布；
4. listener error 投递与 `AggregateError`；
5. destroy terminal / idempotency；
6. classic I18n port 的 scope、service delegation、subscription ownership、destroy；
7. production integration：Service 无 DOM/storage、composition 创建/销毁顺序、core 删除 raw dictionary ownership、saved language 启动回归消失。

4.2 registry test 继续保留数据/兼容性硬门禁，但不再要求已经删除的 raw locale compatibility port；它改为确认 registry 仍是唯一 short-text 数据权威，并确认 4.3 service bridge 不改变 4.2 的 locale/help 边界。

Stage 4 workflow 新增独立 4.3 focused step，同时继续执行 4.1、4.2、locale audit、Architecture、Node、Browser Contract、build 与 Built App Browser 回归。

## 验证状态

当前为实施候选状态。完成临时迁移历史清理后，将压成一笔直接继承 Atomic 4.2 验收提交 `e577c782b4fe37d464b9db6def7291e620780a2f` 的 clean implementation commit，并要求该 commit 完整通过 Stage 4 Atomic Verification。clean commit 全绿前不标记 4.3 PASS，也不进入 4.4。
