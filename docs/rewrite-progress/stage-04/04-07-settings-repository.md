# Stage 4 / Atomic Task 4.7 — Settings Repository

## 状态

Atomic 4.7 **PASS**。15 项 Settings 持久化 I/O 已从 classic `localStorage` 直接访问收敛到 schema 驱动的 Settings Repository；Atomic 4.8 尚未开始。

## 任务边界

本节点只迁移 Settings 持久化 ownership：

- Repository 是 15 个 Settings key 的唯一物理读写者；
- 继续复用 Atomic 4.6 的 Schema / validation / serialization；
- 旧 `localStorage` key 与字符串格式保持；
- classic 代码只能通过窄 compatibility port 调用 Repository；
- 非 Settings 数据（文档、最近文件、pane/sidebar 尺寸等）继续走原有持久化路径；
- 不创建 Settings Store、draft、section controller、Settings UI 或 Theme Service。

## 实施结构

```text
src/features/settings/
  index.js
  compatibility/
    classic-settings-repository-port.js
  infrastructure/
    settings-repository.js
  domain/
    ... Atomic 4.6 contracts
```

### `settings-repository.js`

无状态 Repository，storage 通过构造参数注入，不直接引用 `window.localStorage`。公开：

- `createSettingsRepository({ storage })`
- `SettingsRepositoryReadError`
- `SettingsRepositoryWriteError`

`load(ids)`：

- 先读取全部请求 key，再执行反序列化；
- 缺失、非法 JSON、非法 legacy 值只按 Schema default/normalization 返回内存值；
- load 路径不会修复、覆盖或删除任何存储项；
- 任一 `getItem` 失败立即抛出 `SettingsRepositoryReadError`，且在首个写入发生前终止。

`save(changes)`：

- 先校验/规范化全部设置；
- 在首个 mutation 前预读取所有原始值；
- 使用 Atomic 4.6 serialization 写回历史字符串格式；
- `omitWhenEmpty` 设置通过 `removeItem` 保持原语义；
- 任一写入/quota 失败时逆序恢复所有已触碰 key；
- rollback 失败不会吞掉原始写入异常，而是记录在 `SettingsRepositoryWriteError.rollbackErrors`。

### `classic-settings-repository-port.js`

临时 scoped compatibility bridge，只暴露：

- `load()`
- `get(id)`
- `save(changes)`
- `set(id, value)`

Port 不暴露 raw storage 或 Schema，不拥有 Settings 状态。重复挂载拒绝；`destroy()` 幂等，destroy 后 API 终止。

## 运行时切换

`src/bootstrap/module-entry.js` 在 classic app import 前创建 Settings Repository，并在 `#compatibility-business-ports` 上挂载 scoped port；销毁链负责卸载 port。

`public/app/bootstrap.js`：

- 启动时通过 Repository 一次加载 Settings snapshot；
- theme/language/sidebar/autosave/editor/export/toolbar/preview/visual-editing/layout 均从 typed snapshot 恢复；
- layout 启动恢复显式使用 `persist=false`，避免缺失或非法 persisted value 经 fallback 后在启动阶段被自动覆盖。

`public/app/core.js` / `public/app/editor-tools.js`：

- theme、language、layout、sidebar、Settings 保存、table/code visual editing 的 Settings 写入改为 Repository port；
- 旧 15 个 Settings key 常量与对应直接 `localStorage` I/O 从 classic ownership 删除；
- 文档正文/元数据、最近文件、sidebar width、pane collapse、outline、fullscreen 等非 Settings 持久化保持原路径。

## 数据兼容与安全

保持不变：

- 15 个 legacy key；
- boolean/integer/string/JSON array 历史字符串格式；
- 当前 defaults、合法值集合与用户可观察设置行为；
- 空颜色、空 export directory、空 toolbar hidden items 的删除语义；
- Rust、Tauri command、DTO、依赖、lockfile 均未改。

新增安全保证：

- read failure = **0 writes**；
- malformed/illegal persisted value = fallback in memory，**不自动修复存储**；
- migration/canonicalization 仅在显式 save 时发生；
- partial write failure = rollback 已触碰 key；
- rollback failure = 显式暴露，不静默忽略。

## 测试

新增：

- `tests/unit/settings/settings-repository.test.mjs`：8 项；
- `tests/unit/settings/classic-settings-repository-port.test.mjs`：5 项。

Atomic 4.6 schema 测试同步升级为 cutover 后 ownership 契约，继续验证 legacy key 仍由 Schema 定义，且 4.8 Store/UI/section 尚未提前创建。

生产模块 inventory 从 211 更新为 **213**；Stage 1 历史 67 模块事实保持不变。

## Windows 实机验证

基线：`342f1a208409b285dd8d795dc4f0f4bfaa17ca36`。

用户 Windows 环境实际执行并通过：

- 4.6 Schema + 4.7 Repository/Port：**20/20 PASS**；
- `npm run verify:architecture`：**PASS**；
- `npm test`：**42/42 PASS**；
- Browser Contract：**10/10 PASS**；
- Vite build：**PASS**；
- Built App Browser：**13/13 PASS**；
- `git diff --check`：**PASS**（仅 Windows LF→CRLF 提示）。

## GitHub clean runner 验证

implementation commit：

`e85daf85bcbe21e555cb95132519be8bb604f31a` — `feat(settings): implement atomic task 4.7 repository`

Stage 4 Atomic Verification run `31258797870`：**PASS**（attempt 1）。

Clean runner 实际通过：

- frontend dependency preparation：**PASS**；
- Stage 3 handoff：**PASS**；
- Atomic 4.1：**PASS**；
- Atomic 4.2：**PASS**；
- Atomic 4.3：**PASS**；
- Atomic 4.4：**PASS**；
- Atomic 4.5：**PASS**；
- Atomic 4.6 Settings Schema：**PASS**；
- Atomic 4.7 Settings Repository：**PASS**；
- current locale audit：**PASS**；
- Architecture：**PASS**；
- Node regression：**PASS**；
- Browser Contract：**PASS**；
- Vite build：**PASS**；
- Built App Browser：**PASS**；
- evidence upload：**PASS**。

Evidence：

- artifact：`stage-04-settings-repository-31258797870-1`
- artifact ID：`9022176492`
- artifact size：`6609` bytes
- artifact digest：`sha256:a44084007902a314e12579b8a99d0ad7a25e024a882479a90d128d29620797f1`
- retention：30 days；到期时间 `2026-09-07T13:08:12Z`

## 结论

Atomic 4.7 已完成。Settings persistence 现在只有一个 schema 驱动的物理 I/O owner，classic 调用链通过窄 port 兼容，读取/非法值不会破坏用户持久化数据，写入失败具备 rollback 语义。Atomic 4.8 Settings Store 尚未开始。
