# Atomic 7.1 — 预览行为阈值冻结

## 范围

Atomic 7.1 仅冻结 Stage 7 预览行为阈值，不进入 Atomic 7.2 及之后的 PreviewState、PreviewController、Mode Resolver、Scheduler、Worker Protocol / Session、Render Coordinator 或 Virtual Preview Controller 重写。

## 实际实现

新增 `src/features/preview/pipeline/preview-thresholds.js` 作为唯一预览阈值权威，并由 `src/features/preview/index.js` 暴露只读公共入口。配置在模块求值时递归冻结，不依赖 DOM、平台对象、存储或全局变量。

冻结值来自 Stage 6 既有行为：

- 模式字符阈值：Worker `100000`、Virtual `400000`、Chapter `1000000`、badge `100000`；
- 模式块阈值：Virtual `1400`、Chapter `12000`；
- 输入调度：默认 `18ms`，`40000` 字符后 `70ms`，Worker 档 `120ms`，Virtual 档 `420ms`；
- focus `120ms`；
- 布局稳定：最多 `18` 次、连续 `2` 帧、重试 `34ms`；
- 后处理：`80000` 字符后延后，idle `260ms`，fallback `32ms`；
- prewarm timeout `700ms`；
- enhancement：idle `180ms`、fallback `16ms`、最小 timeRemaining `3ms`；
- Virtual Window：overscan `1000px`、最少 `24` 块、最多 `180` 块、prewarm `96` 块；
- Chapter：最少 `24` 块、优先 `96` 块 / `120000` 字符。

新增 `src/features/preview/compatibility/classic-preview-thresholds-port.js`。组合根显式挂载该 scoped read port；仍处于迁移期的 classic preview 代码只读取同一个冻结对象，不新增 `window.*` 阈值状态，并在销毁时移除端口。

现有预览调用点完成阈值读取切换：

- `public/app/core.js`
- `public/app/preview.js`
- `src/preview/virtual-preview.js`
- `src/preview/preview-worker.js`
- `src/preview/enhancement-queue.js`

跨功能仍共用的大文档阈值未被强制迁入 Preview feature，避免让 bootstrap、editor-tools、web-clipper 等无关职责反向依赖 Preview。

## 测试与门禁

新增：

- `tests/fixtures/preview-behavior-thresholds.json`
- `tests/unit/preview/preview-thresholds.test.mjs`
- `tests/unit/preview/classic-preview-thresholds-port.test.mjs`
- `tests/architecture/stage-07-preview-thresholds.test.mjs`
- `.github/workflows/stage-07-atomic.yml`

架构门禁锁定：

- `src/features/preview/` 在 7.1 仅包含 threshold owner、公共入口和 classic read port；
- 阈值 owner 纯配置且无 DOM / storage / global 依赖；
- 旧 Preview 模块不再拥有已迁移的独立 magic-number 权威；
- 不允许新增全局阈值对象；
- 不允许提前进入 7.2+ 职责；
- classic 脚本阈值别名必须隔离，避免共享 global lexical scope 冲突。

## 验证记录

- RED：run `31614493673`。阈值契约先于实现落地，因 `src/features/preview/index.js` 不存在而按预期失败。
- focused GREEN：run `31615276528`，Atomic 7.1 阈值、兼容端口、架构与 Frozen 检查通过。
- 临时 superset runner：run `31616021327` 未通过；该临时 runner 将大量不同分组测试合并执行，未作为正式验收依据。
- 分组 clean-candidate run `31616688938`：Stage 4–6、7.1、Frozen、Architecture、Node、Browser Contract、Build 均通过，但 Built App 暴露真实启动回归，因此停止发布。
- diagnostic run `31616890482`：确认 Built App 超时等待 `app-ready`。
- 根因：`public/app/core.js` 与 `public/app/preview.js` 作为经典脚本共享 global lexical scope，却同时声明同名顶层 `const previewBehaviorThresholds`；单文件 `node --check` 无法发现跨脚本 lexical collision。
- 修复：分别改为 `corePreviewBehaviorThresholds` 与 `classicPreviewBehaviorThresholds`，阈值对象及行为值不变，并加入架构回归门禁。
- Built App 修复验证：run `31617520656`，focused 7.1、Build、Built App 全部 PASS。
- 完整 clean-candidate 验证：run `31617688127`，Stage 4、Stage 5、CR-05、Stage 6.1–6.14（含真实 Chromium）、Atomic 7.1、Frozen、Architecture、Node、Browser Contract、Build、Built App 与证据上传全部 PASS。

## 兼容性与未改变项

- Frozen DocumentModel hash 保持 `d767d9025be05a6f6b87d7cd3527782db1c3303a`。
- 未修改持久化格式、Rust、公共业务命令语义、配置默认值或依赖。
- 未新增生产依赖。
- `public/app/preview.js` 仍处于 Stage 7 迁移期；Atomic 7.1 只迁移阈值所有权，不宣称预览管线已经完成重写。
- Atomic 7.2 尚未开始。

## 环境说明

本次实施环境没有本地 Git worktree，因此工作区状态、不可变候选树、diff 与验证均通过远端 refs / GitHub Actions 审计。用户另行完成了 Stage 6 本地验证；Atomic 7.1 最终本地验证不在本记录中冒充已执行。
