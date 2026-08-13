# Atomic 7.5 — Worker Protocol

## 范围

- 正式基线：`rewrite/stage-07` / `8411ca112df43e5e898e15fa1583006381907f1b`（Atomic 7.4）。
- 本 Atomic 只建立 Preview Worker Protocol，并把现有 Worker runtime/client 的消息构造与解析切到该唯一协议 owner。
- 协议消息精确覆盖：`reset / transactions / render-window / focus / cancel / error / ack`。
- 每条协议消息强制携带 `generation / version / requestId`。
- Atomic 7.6 的 Worker Session（generation 生命周期、syncedVersion、pending transaction ack、重启/崩溃恢复、stale response 丢弃）未提前实现；7.7+ owner 也未进入本次范围。

## 实现

- 新增 `src/features/preview/worker/preview-worker-protocol.js`：纯协议模块，负责消息类型、envelope 校验、任务 payload 校验、消息构造、`ack/error` 关联；不创建 Worker、不持有 DOM/存储/session 状态。
- `src/features/preview/index.js` 仅导出 protocol API，不导出 Worker Session。
- `src/preview/preview-worker-client.js` 保留现有 workerVersion/initialized/active/pending 等旧 session 状态，只把 legacy `update`/`renderBlocks` 消息迁为 `transactions`/`render-window`，请求与响应统一通过 protocol 构造/解析，并以 requestId + generation 关联当前请求。
- 7.5 兼容阶段使用固定 `LEGACY_PREVIEW_WORKER_GENERATION = 0`；真正 generation 生命周期归 Atomic 7.6。
- `src/preview/preview-worker.js` 通过 protocol 消费 `reset / transactions / render-window`，统一返回 `ack/error`；`focus/cancel` 在协议中已定义，但完整执行语义留给后续 Atomic，不在 7.5 越界实现。
- protocol constructor 已封死 payload 对 `type/generation/version/requestId` 的覆盖；`ack` 的 `acknowledges` 也只能来自原请求类型。
- 原有 `createPreviewWorkerClient()` 公共工厂导出保持不变。

## 影响与兼容性

Preview 渲染、增量模型、prewarm、heading/statistics/reference definitions、用户可观察行为保持不变。DocumentModel、持久化、Rust、配置与生产依赖均未修改。

## 验证记录

- 助手容器无法解析 `github.com`，因此本地 clone/worktree `git status` 无法执行；未将其描述为通过。改用正式 SHA 派生的独立 candidate、immutable Actions checkout 与 clean-tree 重建作为工作区证据。
- RED：run `31668395113` 在 Atomic 7.5 protocol contract 真实失败，证明统一 protocol 尚不存在且 legacy client/runtime 仍拥有旧消息权威。
- 初始 GREEN author：run `31668637220` 的 migrated runtime parse 与 focused contract PASS。
- focused run `31668681558`：7.1–7.5 功能契约 PASS，但独立 parse gate FAIL，Frozen 按硬门禁跳过；未误报通过。
- diagnostic run `31668726838` 将失败定位为 `preview-worker-client.js` heading filter 少一个 `)`；单点修复 run `31668776502` 的 client parse、7.5 focused contract PASS。
- fixed focused run `31668818876` SUCCESS：7.1–7.5、所有修改文件 parse、Frozen hash PASS。
- protocol 完整性收紧后 focused run `31668942777` SUCCESS，并覆盖 payload 不可覆盖协议 identity/correlation metadata。
- 首次完整 candidate run `31668986230`：Stage 4–7.5、真实 Chromium、Frozen、Architecture、Node、Browser Contract PASS，但 Build FAIL，Built App/evidence 正确停止。诊断 artifact 明确错误为迁移时漏掉既有 `createPreviewWorkerClient` 工厂导出。
- factory restoration run `31669250436`：恢复基线已有公共工厂导出后，client parse、7.5 focused contract、`npm run build` PASS。
- 从正式 7.4 直接重建、仅含 6 个合法产品/测试文件的 clean product commit `74f32e6e487126506d9a0eb2619307e01b06133d`；validator run `31669545274` SUCCESS：依赖审计、KaTeX、Stage 4/5/6、三条真实 Chromium、Stage 7 through 7.5、parse、Frozen、Architecture、Node、Browser Contract、Build、Built App 与 evidence 全部 PASS。
- Stage 7→7.5 workflow 由隔离 builder run `31669753784` 生成并核验；保留 7.4 及以前全部门禁，只新增 7.5 protocol tests/parse/evidence。Actions token 不直接提交 workflow 文件，builder 仅生成并写入 Git blob，由最终单父 tree 组装。

## 后续边界

Atomic 7.6 才开始 Worker Session。7.5 不承担 Worker 重启策略、session generation 推进、同步版本确认或 stale response 的 session 级裁决。