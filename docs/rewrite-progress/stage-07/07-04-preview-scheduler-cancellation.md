# Atomic 7.4 — Preview Scheduler / Cancellation

## 状态

候选实现、focused gate、完整 Stage 4→7.4 候选链与第一轮 clean final-tree validator 均已通过；正式分支尚未发布，Atomic 7.5 未开始。

## 基线与范围

- 正式基线：`rewrite/stage-07` / `47ea8b94095a1fcf85f3838bd1d2e1fd3d6d1b08`（Atomic 7.3）。
- 本 Atomic 只迁移 Preview 的 input debounce、selection focus refresh、layout refresh、enhancement scheduling/cancellation。
- `previewLineFocusVersion / previewLineFocusTarget / previewLineFocusPromise` 明确保留给 Atomic 7.11 Focus Controller；未进入 Worker Protocol、Worker Session、Render Coordinator、Virtual Preview Controller 或 Enhancement Coordinator。

## 实现

- 新增 `src/features/preview/pipeline/preview-cancellation.js`：独立拥有 `input / focus / layout / enhancement` 四通道 generation token 与 stale-commit gate。
- 新增 `src/features/preview/pipeline/preview-scheduler.js`：独立拥有 timeout / frame / idle / background 调度资源、同通道合并、continuation 与取消；新 owner 会使旧 token 失效。
- 新增 scoped `classic-preview-scheduler-port.js`；classic 仅通过 `#compatibility-business-ports` 调用，不新增 window scheduler 全局。
- `src/main.js` 在 composition root 创建 Cancellation、Scheduler、port，并按 port → scheduler → cancellation 顺序销毁。
- `public/app/core.js` 移除 `previewUpdateTimer / previewFocusUpdateTimer / previewEnhancementRaf / previewEnhancementIdle` 调度权威。
- `public/app/preview.js` 移除上述资源及 `previewLayoutRefreshFrame / previewLayoutRefreshTimer / previewLayoutRefreshSequence`，四类调度切换到独立 channel。
- layout await/continuation、enhancement annotation/background finish 均在 commit 前检查当前 token；现有 PreviewState render version 仍保留为第二层 stale-result 防线。
- background 优先复用现有通用 TaskScheduler；无 background scheduler 时回退 idle，再无 idle 时按既有 fallbackMs 走 timer。取消资源异常会显式聚合上报，不静默忽略。
- `preview-prewarm` 与直接 outline/navigation focus request 不属于 7.4，本次未迁移。

## 影响与兼容性

输入延迟阈值、focus 延迟、layout retry/stable-frame 阈值、enhancement idle timeout/fallback、PreviewState 版本语义和用户可观察行为保持不变。DocumentModel、持久化、Rust、配置、生产依赖均未修改。

## 验证

- 本地 worktree：助手容器尝试 clone 时 `github.com` DNS 无法解析，因此未将本地 `git status` 描述为已完成；改用从正式 SHA 新建的远端 candidate 与 GitHub Actions clean checkout 作为工作区证据。
- RED：run `31664689919`，1 PASS / 5 FAIL；目标 scheduler/cancellation/port 尚不存在、classic 仍持有旧资源权威，符合预期。
- 首轮 GREEN：run `31665069454`，23 PASS / 1 FAIL；唯一失败为 7.2 历史架构断言仍把合法新增的 `preview-scheduler` 视为未来模块，因此未提交半成品生产迁移。
- 修正历史门禁后 author run `31665125500` SUCCESS；只允许 7.4 Scheduler/Cancellation，继续禁止 7.5+ owner。
- Focused：run `31665425428` SUCCESS；7.4 scheduler/cancellation、classic port、7.1–7.3 历史架构、修改模块 parse 与 Frozen DocumentModel 精确哈希全部 PASS。
- 额外覆盖：旧 async task、旧 continuation、旧 background handle 均不可提交；cancel/destroy 释放 timer/frame/idle/background 资源；fallback delay 与 cleanup error reporting 有单测。
- 首次完整候选 run `31665672683`：Stage 4/5/6 静态链 PASS，但 Stage 6 聚合 real-browser handoff 单步失败，因此后续硬门禁正确停止；未将该次运行描述为通过。
- 为定位该失败，diagnostic run `31665859447` 在**同一不可变候选 `817fad86adb1ddae4485fb34254fd42e68d42c3d`**上将 submenu / recent-files / window-lifecycle 三个 Chromium handoff 拆为独立 job，三项全部 SUCCESS，未修改被测产品树。
- 基于上述可复现诊断，原样重跑同一不可变候选：run `31665912350` SUCCESS；exact checkout、依赖审计、KaTeX、Stage 4/5/6、真实 Chromium、Stage 7 through 7.4、修改模块 parse、Frozen、Architecture、Node、Browser Contract、Build、Built App 与 evidence 全部 PASS。
- 第一轮 clean final tree：`9c21264836c5870cdd22f04004e7bb0f3548298d`，相对正式 7.3 为 ahead 1 / behind 0 / 单提交 / 正好 17 个合法文件，且无任何 `atomic-74-*` workflow 或临时 author 脚本。
- clean final-tree validator run `31666262840` SUCCESS；exact clean-tree 证明、依赖审计、KaTeX、Stage 4/5/6、真实 Chromium、Stage 7 through 7.4、parse、Frozen、Architecture、Node、Browser Contract、Build、Built App 与 evidence 全部 PASS。

## 已知限制 / 后续

Atomic 7.5 Worker Protocol 尚未开始。由于本记录与根 README 现在写入了第一轮 clean final-tree validator 的真实结果，发布树发生文档字节变化；必须重建单父 final tree 并对更新后的最终不可变树再执行一次完整验证，通过后才允许非强制 fast-forward 到 `rewrite/stage-07`。
