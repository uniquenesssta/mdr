# Atomic 7.2 — Preview State

## 范围

Atomic 7.2 只迁移 Preview 运行时状态所有权，不进入 Atomic 7.3 Mode Resolver、7.4 Scheduler/Cancellation 或后续 Worker/Renderer 重写。

唯一状态对象 `src/features/preview/application/preview-state.js` 负责：

- `mode`
- `version`
- `status`
- `lastStableResult`
- `focusSection`
- `error`

`previewPerformanceMode` 继续由 Settings 持久化拥有；`previewLineFocusVersion` 继续作为后续 Focus Atomic 的请求取消令牌。

## 实现

新增 `PreviewState` 纯应用状态模块与 `classic-preview-state-port.js` scoped compatibility port。组合根创建唯一实例并负责销毁。classic Preview、Web Clipper 与 Editor Tools 通过同一端口读取状态，不复制第二份状态。

从 classic 路径移除以下 Preview 运行时状态权威：

- `previewRenderVersion`
- `activeResolvedPreviewMode`
- `activePreviewScopeKey`
- `activePreviewFocusChapter`
- `previewWorkerFailureNotified`

PreviewState 使用不可变快照；render generation 拒绝 stale commit；错误状态保留最后稳定结果；稳定结果只允许数据型元数据，不允许 DOM/runtime object。真实 Worker 的 chapter 数据字段 `headingId/startLine/endLine/startIndex/endIndex/focusIndex` 已纳入严格数据契约。

原先 Worker 大文档失败恢复通过 `.markdown-body` 是否存在隐式判断“是否有最后稳定预览”。现在先读取 `lastStableResult` 决定状态，再仅用 DOM 判断该投影是否仍可挂载；layout/resize/unchanged reuse 同样先读取 PreviewState，因此 DOM 不再是 Preview 状态源。

## 兼容性

用户可观察的 Preview 策略、Settings 中的 auto/full/virtual/chapter 偏好、阈值、DocumentModel、持久化结构、Rust 与依赖均未改变。现有 classic Preview 调用通过 scoped compatibility port 迁移，未新增 `window.*` Preview State 全局。

## 验证记录

- 旧状态所有权审计：GitHub Actions `31620729330` PASS。
- RED 契约：`31621048827` 按预期失败，原因是实现前 `createPreviewState` 尚不存在。
- focused state/port/architecture/Frozen 验证：`31622624138` PASS；覆盖 stale generation、last stable/error、data-only state、focusIndex、subscription/destroy、compatibility port、DOM 非状态源与 Atomic 7.3+ 未提前进入。
- clean candidate 完整阶段回归：`31623433636` PASS；覆盖依赖审计、KaTeX serving、Stage 4、Stage 5、Stage 6.1–6.14、6.11–6.13 真实 Chromium、Atomic 7.1–7.2、修改文件解析、Frozen、Architecture、Node、Browser Contract、Build、Built App 与 evidence 上传。
- Frozen DocumentModel hash：`d767d9025be05a6f6b87d7cd3527782db1c3303a`。
- 正式发布前要求最终不可变树再次通过与 clean candidate 等价的完整验证；未通过则不得推进正式分支。

## 当前限制

Atomic 7.2 不负责模式解析规则、调度/取消策略、Worker Session、Render Coordinator、Virtual Preview Controller 或 Focus Controller；这些职责必须按后续 Atomic 独立迁移。
