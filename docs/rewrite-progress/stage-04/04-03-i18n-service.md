# Stage 4 / Atomic Task 4.3 — I18n Service

## 状态

Atomic 4.3 **PASS**。clean implementation commit 已完整通过 Stage 4 gate。4.4 Translation Bindings 与 4.5 Help Content/Controller 尚未开始。

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

它不向 `window` / `globalThis` 发布 I18n facade，也不暴露 locale registry 或字典对象。bridge 跟踪通过它创建的 subscriptions；destroy 时先取消订阅再卸载 host property，之后所有调用明确失败。

### 3. composition root 创建唯一 I18n Service

`src/bootstrap/module-entry.js` 现在按以下顺序启动：

1. 创建 App Shell；
2. 挂载 compatibility business content；
3. 创建唯一 I18n Service；
4. 在 existing hidden ports host 上挂载 classic I18n bridge；
5. 加载 4.5 前的 legacy help content；
6. 导入当前 application。

启动失败或显式 destroy 时按反向顺序清理：classic script → I18n port → I18n Service → compatibility content → UI。I18n port 与 service 均为独立可销毁职责。

### 4. classic `core.js` 删除翻译算法和 locale state ownership

`public/app/core.js` 不再保存 `let currentLang`，也不再读取 locale registry / dictionary。

原 `t()` 只保留 classic lexical compatibility 入口，内部委托 `coreI18nPort.t(key, ...args)`；fallback 和格式化算法只有 I18n Service 一份权威实现。

原 `setLanguage()` 当前只承担 4.6 前的设置持久化兼容职责：

1. 调用 `coreI18nPort.setLocale(lang)`；
2. 将服务返回的 resolved locale 写回既有 `md_editor_language` key；
3. 调用旧 `applyLanguage()` compatibility binding。

`applyLanguage()` 仍执行 `[data-i18n*]` 全 DOM 扫描，但它不属于 I18n Service，也不拥有 locale 状态；当前 locale 每次从 `coreI18nPort.locale` 获取。该扫描明确留给 Atomic 4.4 删除，4.3 未提前重写 Translation Bindings。

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

当前生产模块数由 187 更新为 **188**。Stage 1 历史 67 模块事实不修改，仅更新 current inventory 断言。

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

新增 `tests/unit/i18n/i18n-service.test.mjs`，共 7 项，覆盖：

1. locale state、initial/default/invalid normalization；
2. `t()` 参数替换、默认 fallback、key fallback；
3. locale change 事件、不可变 event、重复切换不发布；
4. listener error 投递与 `AggregateError`；
5. destroy terminal / idempotency；
6. classic I18n port 的 scope、service delegation、subscription ownership、destroy；
7. production integration：Service 无 DOM/storage、composition 创建/销毁顺序、core 删除 raw dictionary ownership、saved language 启动回归消失。

4.2 registry test 继续保留数据/兼容性硬门禁，但不再要求已经删除的 raw locale compatibility port；它确认 registry 仍是唯一 short-text 数据权威，并确认 4.3 service bridge 不改变 4.2 的 locale/help 边界。

实施验证中发现 4.2 audit 测试曾把新增 Service/bridge 的 forwarding `t(key)` 也计入“动态翻译业务调用总数”，使全仓库动态调用从 4 变为 8。修复只将 4.2 断言限定为仍需冻结的 `public/app/core.js` 四条实际动态业务调用；unknown key、placeholder、key-set、help SHA 等硬门禁均未放宽。

## 最终验证

clean implementation commit：

`c14722e23c5bc5757b04be3cfd062be2c0442fe2` — `feat(i18n): implement atomic task 4.3 service`

Stage 4 Atomic Verification run `31243072471`：**PASS**。

- Stage 3 handoff：**6/6 PASS**；
- Atomic 4.1 历史契约：**7/7 PASS**；
- Atomic 4.2 locale split/registry：**7/7 PASS**；
- Atomic 4.3 I18n Service：**7/7 PASS**；
- 当前 locale audit：**PASS**；
- Architecture：**PASS**；
- Node regression：**42/42 PASS**；
- Browser Contract：**10/10 PASS**；
- Vite build：**PASS**；存在既有 >500 kB chunk advisory；
- Built App Browser：**12/12 PASS**；
- evidence artifact：`stage-04-i18n-service-31243072471-1`；
- artifact ID：`9017628747`；
- artifact digest：`sha256:b7165c8d2280500ba258ef050ea1643684198999a67b43c2a9926c708d4b2710`。

GitHub runner 的 `deps:prepare` 继续报告 committed dependency baseline 的 4 个既有 advisory（2 moderate、2 high）。4.3 未修改依赖或 lockfile，也未把用户另一工作区的受保护 lockfile 变更带入 Stage 4。

## 结论

Atomic 4.3 已完成并通过全部当前硬门禁。I18n Service 已成为 locale state / translation / fallback / change event 的唯一运行时权威；DOM binding 仍明确留给 4.4，Help 正式模块仍留给 4.5。4.4 尚未开始。
