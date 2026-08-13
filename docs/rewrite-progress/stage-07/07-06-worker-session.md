# Atomic 7.6 — Worker Session

## 范围

- 正式基线：`rewrite/stage-07` / `3260206effb5691ac8adb73a931894fed43abed0`（Atomic 7.5）。
- 本 Atomic 只迁移 Worker Session 职责：同步版本、事务确认、Worker 生命周期/重启、generation/requestId 关联与 stale response 丢弃。
- `PreviewWorkerClient` 继续负责文档结果缓存以及 update/prewarm 高层排队，不再拥有 Worker session 状态或消息监听/关联。
- Worker 失败时必须保留最后稳定预览；没有稳定结果时显示恢复状态，禁止退回主线程全文 Markdown 渲染。
- Atomic 7.7 Render Coordinator 及更后 owner 未进入本次范围。

## 实现

- 新增 `src/features/preview/worker/preview-worker-session.js`，作为 Worker session 唯一 owner：管理 `generation / requestId / initialized / syncedVersion / pending request / restart / destroy`，并通过 7.5 的 `preview-worker-protocol.js` 构造和解析消息。
- `src/features/preview/index.js` 导出 `createPreviewWorkerSession`。
- `src/preview/preview-worker-client.js` 删除自己的 `workerVersion / initialized / requestId / Worker listeners / handleMessage / resetWorker` 权威；update/prewarm 通过 Session 请求，ACK 后读取 Session 的单一同步版本。
- Session 在 reset/transactions ACK 后推进 syncedVersion；未知 requestId、旧 generation 响应直接丢弃，不能提交到当前请求。
- Worker error、协议错误和显式 restart 会终止旧 Worker、清空同步状态并推进 generation；destroy 后终止 Worker、拒绝未决请求并禁止新请求。
- `public/app/preview.js` 将 Worker failure safe fallback 扩展到所有 Worker 失败：有 `lastStableResult` 时保留稳定 DOM，无稳定结果时显示恢复中；主线程 whole-document fallback 仅允许 `!workerFailed`。
- 7.5 protocol 架构门禁仅窄化为允许 `preview-worker-session.js`，仍禁止 7.7+ Preview owner。

## 影响与兼容性

- `createPreviewWorkerClient()` 公共工厂、update/prewarm 调用语义、PreviewState/Mode/Scheduler/Protocol 公共边界保持不变。
- DocumentModel、持久化格式、Rust、配置、生产依赖均未修改。
- Worker 故障路径的兼容行为按任务书收紧：不再允许 10 万至 40 万字符或手动 Worker 模式在故障时回退到主线程全文 `marked` 渲染，而是保留稳定预览或进入恢复状态。

## 验证记录

- 用户本地工作区不可由当前执行环境读取；未将 `git status` 描述为已执行。实现从正式 7.5 SHA 精确派生独立 candidate，并通过 clean-tree 重建与 immutable Actions checkout 保护基线。
- RED：run `31685044025` 真实失败，结果 1 PASS / 4 FAIL；失败精确证明 Session 尚不存在、legacy client 仍拥有 session 状态/监听、Worker failure 仍存在受字符阈值限制的主线程全文 fallback。
- Worker fallback 精确迁移 author run `31685459341` SUCCESS，替换后 `public/app/preview.js` syntax PASS。
- focused run `31685512044` SUCCESS：Stage 7 through 7.6 focused tests、修改模块 parse、Frozen DocumentModel hash 全部 PASS。
- 从正式 7.5 tree 直接重建仅含 7 个合法产品/测试文件的 clean product commit `4da178d1953600dd3521d7c4eaa06f1434e65e4c`；validator run `31685792936` SUCCESS：依赖审计、KaTeX、Stage 4/5/6、三条真实 Chromium、Stage 7 through 7.6、parse、Frozen、Architecture、Node、Browser Contract、Build、Built App 与 evidence 全部 PASS。
- Stage 7→7.6 workflow builder run `31685997034` SUCCESS；只新增 7.6 Session tests/parse/evidence 并保留 7.5 及之前全部门禁。run `31686151715` 再次生成同一内容并把已验证字节保存为普通 Git blob，供最终 clean tree 使用；临时 builder 路径不进入正式树。
- 首个完整 final tree commit `5e0b7828a0e56adef836c942ed2b88ea4756ec67` 的 validator run `31686363540` SUCCESS：exact clean-tree/README 门禁、依赖审计、KaTeX、Stage 4/5/6、真实 Chromium、Stage 7 through 7.6、parse、Frozen、Architecture、Node、Browser Contract、Build、Built App 与 evidence 全部 PASS。

## 后续边界

Atomic 7.7 才开始 Render Coordinator。7.6 不实现 render coordination、virtual preview controller、layout stability、focus controller、enhancement coordinator 或 DOM renderer。
