# Stage 5 / Atomic Task 5.8：Editor Controller

## 状态

- 结果：**PASS**。
- 正式父基线：`a0e9372f44a68738f8320b0f97855ef2069c35ab`（Atomic 5.7 正式 HEAD）。
- 正式实现提交：`da8c1006e92cc786597c384ae5bd074d9cd43b87`。
- 正式 Stage 5 CI：GitHub Actions run `31348701732` — **SUCCESS**。
- 正式 evidence：`stage-05-editor-controller-31348701732-1`。
- Evidence ID：`9048224809`。
- Evidence digest：`sha256:aef36018f2576182cfb1b5146e5c8aa8d0a6ab3165b18126d7bc81c882f84521`。
- Atomic 5.9 History Adapter：**未开始**。

## 任务书边界

本节点严格对应 `agent/plan/markdown-main-full-rewrite-taskbook-18-docs/06-阶段05-文档会话与编辑器基础.md` 的 Atomic 5.8：Editor Controller 连接冻结 `DocumentModel` 与中性 editor adapter；编辑输入形成模型事务事件；迁移本节点确认的 classic 整正文写入，使 UI/兼容调用者不再直接赋值 `editor.value`。本节点不提前实施 5.9 History Adapter，也不迁移完整混合编辑、预览或后续 Editor 命令/UI。

原候选将 5.8 新职责落在 `src/editor/application/`。正式发布前按任务书纠正为 `src/features/editor/`；该错误路径没有进入 `rewrite/stage-05` 正式历史。5.5–5.7 已发布的 CodeMirror/Pointer 目录不在本 Atomic 中跨节点搬迁，需在进入 5.9 前作为 Stage 0–5 taskbook conformance audit 的既有结构项继续核对。

## 最终职责边界

### `src/features/editor/application/editor-controller.js`

唯一负责 DocumentModel 与 editor adapter 的编辑事务协调：

- 构造时校验 Model/adapter 契约和版本一致性；
- adapter 文档变化先提交到冻结 DocumentModel，再发布模型权威事务快照；
- `setText()` 通过 `DocumentModel.replaceRange()` 完成整正文替换，不直接写 adapter/DOM；
- 区分 interactive 与 programmatic 事务；
- 拒绝 adapter 已变化但模型没有确认提交的版本漂移；
- listener/reporting 异常不阻断已完成的模型提交；
- `destroy()` 幂等、终态并解绑 adapter subscription。

正文与版本权威仍唯一属于冻结 `DocumentModel`；Controller 只拥有事务订阅集合和 adapter subscription 生命周期，不建立第二套正文或历史状态。

### `src/features/editor/compatibility/classic-editor-controller-port.js`

只把 Editor Controller 的受限能力挂载到既有 `#compatibility-business-ports`：

- 不发布 `window.*` 全局 Editor facade；
- 不拥有正文、版本或历史；
- 重复挂载拒绝；
- `destroy()` 清除自身 host property，终态且幂等。

### `src/features/editor/index.js`

作为 Stage 5 Editor feature 公共入口，只公开本节点已建立的 Editor Controller 与 scoped compatibility mount。`src/main.js` 通过该 Feature 公共入口消费 5.8 新职责；既有 `createVirtualEditor` 仍从其已验证旧路径导入，本节点不假装完成 5.5–5.7 的目录迁移。

## 调用链迁移

本节点切换以下确认的整正文/输入链：

- `public/app/bootstrap.js`：启动清空正文改经 Editor Controller port；
- `public/app/editor-tools.js`：清空及现有 legacy undo/redo 恢复正文改经 Controller port；`historyStack` 本节点不删除，保留给 5.9；
- `public/app/events.js`：不再直接监听 DOM `input` 作为业务事务入口，改订阅 Controller 事务并只消费 interactive 事务；
- `public/app/web-clipper.js`：确认的整正文替换/空文档写入改经 Controller port；
- `src/main.js`：在 DocumentModel 与 Virtual Editor 建立后创建 Editor Controller，挂载 scoped compatibility port，并纳入失败回滚和销毁顺序。

没有新增第二个 Editor 状态所有者，也没有留下 `src/editor/index.js` 转发壳。

## 生产模块与兼容性

- 生产模块：**257 → 260**。
- `src/document/document-model.js` 保持冻结，blob hash：`d767d9025be05a6f6b87d7cd3527782db1c3303a`。
- `package.json`、`package-lock.json` 未修改。
- 未新增生产依赖。
- 未修改持久化格式、Rust/Tauri DTO、设置 key/default、错误码、权限或安全策略。
- 5.9 的全文 `historyStack` 删除尚未开始。

## 验证

### Taskbook-conformant clean-runner

临时 formalizer 最终权威 run `31348556001`：**SUCCESS**。同一份任务书目录纠正后的生产 tree 通过：

- dependency audit：0 vulnerabilities；
- Stage 4 handoff：99/99；
- Atomic 5.1–5.8 聚合专项：65/65；
- Frozen DocumentModel：PASS；
- Architecture hard gate：PASS；
- Node regression：44/44；
- Browser Contract：10/10；
- Production Build：PASS；
- Built App：22/22；
- diff cleanliness：PASS。

前置 formalizer 的失败均在正式分支外按硬门禁停止：一次为 runner 暂存处理、一次为根 README 超出既有长度门禁、一次为临时 workflow 文件名使用被禁止的 `v2` 后缀、一次为 GitHub Actions token 缺少 workflow 写权限。没有删除、跳过或放宽任何生产测试/架构门禁。

### 正式分支验证

正式实现提交 `da8c1006e92cc786597c384ae5bd074d9cd43b87` 的 Stage 5 run `31348701732`：**SUCCESS**。所有 5.1–5.8 专项、冻结 DocumentModel、architecture、Node、Browser Contract、build、Built App 及 evidence upload 均完成并通过。

### 文档闭环回归

首个文档闭环提交 `82b69db4ec201e43a7e8c2ae381e32d1a55ee199` 的 run `31348854833` 在 Node regression **43/44** 停止。唯一失败为 `tests/documentation-layout.test.mjs` 要求根 README 必须保留 `[docs/README.md](docs/README.md)` 链接；5.1–5.8 专项、冻结模型和 architecture 在该 run 中均已通过，后续 Browser/Build/Built App 按硬门禁自动跳过。修复只恢复既有文档入口并保留 5.8 验收记录链接，不修改生产源码、不删除或放宽测试；修复后的文档 HEAD 必须重新通过同一正式 workflow 后才可作为最终闭环 HEAD。

## 环境限制与剩余风险

当前执行环境无法通过本地 Git checkout 访问 GitHub（DNS 解析受阻），因此无法对用户本地工作区执行 `git status --short --branch`，也不能证明用户本地是否存在未提交修改。替代验证采用：正式远端分支精确 SHA 锁定、`force=false` fast-forward 发布、GitHub clean runner 全链验证，以及发布前后远端 HEAD/tree 核对。该限制不影响本次正式远端 commit/CI 结果，但用户本地工作区状态仍需用户本地自行确认。

进入 5.9 前仍需处理已发现的 Stage 0–5 taskbook conformance audit：特别是 5.5–5.7 已发布 Editor 基础设施目录与 `agent/plan` 目标目录的一致性，不能因 5.8 已 PASS 就自动视为已解决。

## CR-05 — Stage 5 Editor Infrastructure Conformance（2026-08-10）

### 审计基线与复现

CR-05 以 `agent/plan` 的 Stage 5 任务书为结构与职责基准，以正式 `rewrite/stage-05@2df9dee17c852ea5f85c661b47cc4d11c693cbfc` 为实施基线，只处理已经完成的 Atomic 5.5–5.8，不开始 Atomic 5.9，也不提前迁移完整 Hybrid Editor、Preview、后续命令或 Editor UI。

新增永久 `tests/architecture/stage-05-editor-infrastructure-conformance.test.mjs` 后，初始 audit run `31366009746` 按预期失败并复现既有结构债务：5.5 CodeMirror Adapter、5.6 Extension Registry、5.7 Pointer Selection 仍位于 `src/editor/`；旧 `src/editor/codemirror/index.js` 转发 facade 仍存在；`src/features/editor/index.js` 未成为 5.5–5.8 统一公共边界；已完成 Editor 模块的 taskbook 职责/依赖/导出/状态/Lifecycle 说明也不完整。

### 修复结果

已将既有实现按任务书收敛到唯一生产所有权：

- `src/editor/codemirror/codemirror-adapter.js` → `src/features/editor/infrastructure/codemirror-editor-adapter.js`；
- `src/editor/codemirror/codemirror-extension-registry.js` → `src/features/editor/infrastructure/codemirror-extension-registry.js`；
- `src/editor/pointer-selection/{precise-pointer-selection,caret-boundary-reader,pointer-selection-policy}.js` → `src/features/editor/infrastructure/pointer-selection/`；
- 删除 `src/editor/codemirror/index.js`，没有保留 forwarding copy、别名实现或兼容壳；
- `src/features/editor/index.js` 统一公开中性 Adapter、Extension Registry、Editor Controller 与既有 scoped compatibility mount；
- `src/editor/virtual-editor.js` 的 5.5/5.6 基础设施消费改经 Editor feature 公共入口；
- Extension Registry 继续调用既有 `src/editor/hybrid-markdown.js` facade，未把未来 Stage 8 Hybrid Editor 工作提前并入 CR-05；
- 对已完成 Editor 模块补齐与真实实现一致的 Responsibility / Imports / Exports / State/side effects / Lifecycle 契约；
- 架构清单和受影响测试切换到新唯一路径。

删除旧 CodeMirror 转发 facade 后，当前 production module fixture 从 262 变为 261；只更新当前模块库存断言，Stage 1 历史“67 个生产模块”证据保持不变。

CR-05 没有修改冻结 `DocumentModel`、用户可观察编辑行为、持久化格式、Settings、Rust/Tauri 公共契约、错误语义、安全策略、生产依赖或 lockfile。Atomic 5.9 History Adapter 仍未开始。

### 验证与失败记录

第一轮 materialization run `31366377596` 中，CR-05 conformance、5.5–5.8/Hybrid 专项和 Architecture 均通过，但完整 Node regression 在当前 production module count `261 !== 262` 停止；候选未发布。该断言随后只从 262 更新为实际 261，没有改写 Stage 1 历史数字，也没有删除或放宽架构门禁。

修正后的 focused run `31366554414`：CR-05 contract **3/3 PASS**；已完成 Editor/Hybrid 专项 **34/34 PASS**；Architecture PASS；Node regression **44/44 PASS**；`git diff --check` PASS。

实现候选 `ad843dc8feed7cfef0f49272000f7e1337e45e07` 的跨阶段验证结果：

- Stage 0 Baseline Verification `31366719716`：PASS；Node、Browser Contract、Build、Built App、`cargo test --locked`、`cargo check --locked`、extended Tauri Linux build、evidence 与 hard gate 全部成功；
- Stage 1 Atomic Verification `31366719737`：PASS；
- Stage 2 Atomic Verification `31366719715`：首次在 Browser Contract 启动 Chromium 时出现 `CDP endpoint did not become ready: fetch failed`；2.1–2.11、Architecture 与 Node 已先通过。未修改代码或门禁，只重跑同一失败 job，随后 Browser Contract、Build、Built App 全部 PASS；
- Stage 3 Atomic Verification `31366719703`：PASS；
- Stage 4 Atomic Verification `31366719713`：PASS；
- Stage 5 Atomic Verification `31366719714`：PASS；5.1–5.8、CR-05 永久 conformance gate、冻结 DocumentModel、Architecture、Node、Browser Contract、Build、Built App 与 evidence 全部成功；
- Stage 3 Windows Window Automation `31366719767`：首次 release build、隔离 WebDriver host build、输入校验全部成功，但真实自动化在 Embedded WebDriver 建立 session 时报告 `No window could be found`，尚未进入 CR-05 Editor 操作断言；失败 evidence 的 `state-application.log` 为空且未发现应用 panic/JS/Rust 错误。未改源码或门禁，仅重跑同一 Windows job 一次，随后真实原生窗口自动化与 evidence 全部 PASS。

上述两类瞬态失败均保留在验证记录中，没有被描述为首轮通过，也没有通过删除、跳过、弱化测试或修改质量门禁处理。

### 剩余边界与环境限制

CR-05 已关闭 5.8 记录中明确留下的 5.5–5.7 taskbook 目录一致性债务。`src/editor/virtual-editor.js` 仍承担尚未轮到的后续拆分职责；`src/editor/hybrid-markdown.js` 仍是未来 Stage 8 Hybrid Editor 迁移链的一部分，因此本 CR 不创建虚假的提前完成状态。Atomic 5.9 仍为未开始。

当前执行环境没有可用的用户本地 Git checkout，且容器侧 GitHub DNS 访问受阻，因此不能替用户确认其电脑工作区中的未提交修改。远端实施通过精确正式 SHA、隔离分支、净 diff、GitHub clean runner 与真实 Windows 自动化完成验证。
