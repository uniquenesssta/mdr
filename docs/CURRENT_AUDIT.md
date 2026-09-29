# MDR 当前实现审计与 R12-14 验收裁定

> 本文是首次阶段验收记录。用户随后明确要求全仓审计及仅 Windows 验证；当前裁定、全量清单与约束评估请看 [FULL_CODE_AUDIT.md](FULL_CODE_AUDIT.md)。

审计日期：2026-09-29（Asia/Shanghai）。审计基准：`agent/r12-stage` / `3cc56f09188ef9c432247788723e36415f9f3e03`。初始完整 Git 检出洁净。本次仅更新验收、状态及审计文档，不修改生产源码、依赖、测试和工作流，也不实施 R12-15。

## 1. 结论与范围

**R12-14 既有 CI 全绿，但功能验收未通过；阶段 12 不能收官。** 原因是前端日志构造与 Rust 递归脱敏未形成完整链路。与此同时，当前 CI 的“Full Node regression”没有覆盖仓库全部 Node 测试，补跑发现明确失败，不能据此宣称当前分支累计回归全部通过。

本轮完整审计覆盖项目规则与阶段状态、R12-14 全量提交差异、全仓测试入口、模块清单和冻结模型、预览/混合编辑 HTML 边界、Worker 代次及调度取消、保存/自动保存/关闭保存、Rust 文档快照/日志恢复、本地文件读写与目录树、外部链接、网页抓取、日志、依赖及构建。对这些链路执行静态检查和现有可执行检查，深入追踪发现的具体问题。并非每个模块的逐行形式化证明，也不等同于真实 Windows 桌面全功能验收；证据限制在第 5 节明确列出。

R12-01～13 保留其历史验收记录，不改写历史；新的累计回归失败是当前 HEAD 必须处理的问题。R12-15～17 尚未实施，R12-S01 仍待策略确认。阶段 13～17 的计划不构成本次实施授权。

## 2. R12-14 既有验证证据

[Actions #36444268636](https://github.com/uniquenesssta/mdr/actions/runs/36444268636) 对上述精确提交执行，4 个 job 全部成功。已读取 job 步骤以及 Rust、前端原始日志：

| 证据 | 结果 | 证明范围 |
| --- | --- | --- |
| R12-14 Rust 脱敏 | 6/6 | 递归 JSON 对象、数组、字段名和路径字段 |
| Rust 完整测试 | 217 + 5 + 1 + 6，无失败 | 当前工作流运行的 Rust 测试目标 |
| 累计定向 Rust | 全部通过 | 本地文件、链接、真实 HTTP 等已配置回归 |
| Clippy / Cargo check | 通过 | 警告拒绝及编译检查 |
| 根目录 Node | 452/452 | `tests/*.test.mjs`，不是递归全仓测试 |
| 阶段与平台定向 Node | 112/112 | Stage 12 + 三个平台客户端文件等 |
| 四项架构/文档 CLI | 通过 | 现有 CLI 规则，不能替代未执行的架构测试 |
| 浏览器契约 / 构建后浏览器 | 10/10、29/29 | 当前专属 runner 配置的 39 项 |
| Production build | 通过 | Vite 前端构建，不是 Windows Tauri 安装包构建 |
| Windows/macOS native job | 通过 | opener 编译、链接、函数签名；没有真实打开浏览器或启动桌面 GUI |

本轮本地再次执行根目录 Node 452/452、四项架构/文档 CLI、Vite 构建，均通过。`npm audit --json` 返回已安装锁文件依赖的公告漏洞数 0；这不证明应用源码没有安全问题。

## 3. 发现与处理建议

### A01 · P1 · R12-14 字符串化绕过脱敏，阻塞本任务验收

**位置**：`src/runtime/performance.js:42–63, 213–218, 417–437`；`src/platform/desktop/invoke-client.js:69–78`；`src-tauri/src/performance_log/redaction.rs:81–99`；`src-tauri/src/performance_log.rs:120–128`。

`safeDetails()` 将普通嵌套对象先 `JSON.stringify()` 再裁剪成字符串。Rust 只根据字段名判断正文、秘密或路径，未知字段内的字符串直接 `clone()`，不会检查已字符串化的对象。错误链路还把自由文本写入 `error`、`message`、`reason`，其中的完整路径或敏感内容不受上述字段名规则处理。

本轮通过 Node VM 加载实际 `performance.js`，仅为测试暴露原有 `record/flush`，令 `import.meta.env.DEV=false` 避免 DOM 初始化，并注入捕获 LogsPort，执行真实前端构造和发送函数。合成输入：

```json
{"nested":{"body":"SYNTHETIC_BODY","token":"SYNTHETIC_TOKEN","path":"C:/Private/note.md"},"error":"Cannot open C:/Private/note.md; token=SYNTHETIC_TOKEN"}
```

发送到 LogsPort 的实际 `details`：

```json
{"nested":"{\"body\":\"SYNTHETIC_BODY\",\"token\":\"SYNTHETIC_TOKEN\",\"path\":\"C:/Private/note.md\"}","error":"Cannot open C:/Private/note.md; token=SYNTHETIC_TOKEN"}
```

这一步验证了真实前端行为，**不是 Rust 实际落盘测试**。后端普通字符串原样保留、最终 `to_string` 写盘可由源码确定；当前没有覆盖该链路的落盘断言。不是声称用户的真实秘密已经泄露。影响现有 debug 日志，release 仍按 `debug_assertions` 禁用该写入。

**建议**：先明确允许记录的诊断字段及错误信息策略；保留可递归结构或在权威写盘边界安全处理字符串化输入，覆盖错误文本和路径嵌套对象。新增“真实前端 payload → Rust 写盘 → 读取 JSONL”断言，证明正文、路径和合成秘密均未落盘。保留唯一脱敏权威，避免前后端各维护一套相互冲突的规则。完成后才验收 R12-14。

### A02 · P1 · 累计回归入口遗漏，历史测试和模块清单已失效

**位置**：`package.json` 的 `test`；`.github/workflows/r12-14.yml:118–144`；`tests/unit/`、`tests/architecture/`、`tests/ui/`。

`npm test` 只选择根目录的 75 个 `.test.mjs`。当前 workflow 另外选择的 unit 文件仅 `link-client`、`web-fetch-client`、`file-system-client`。包括直接相关的 `performance-log-client` 在内，大量功能测试没有进入当前累计 job。已执行的 CLI 与这些独立测试不是同一集合。

本轮枚举全部仓库 `.test.mjs` 并分三组运行，共得到 1417 个 runner 结果，1370 通过、47 非通过：

| 集合 | 文件数 | runner 结果 | 通过 | 非通过 |
| --- | ---: | ---: | ---: | ---: |
| 根目录 | 75 | 452 | 452 | 0 |
| unit | 124 | 547 | 542 | 5 |
| architecture + ui + e2e | 91 | 418 | 376 | 42 |

47 项中，**39 项为当前测试断言/文件加载失败，8 项为缺少 Chromium 导致的测试文件启动失败**。有文件在加载阶段停止，内部用例未展开，不能把 1417 当作全部预期行为用例数。更不能把这 47 项称为 47 个产品功能 bug。

已定位的主要原因：

- 旧测试仍读取已删除的 `public/app/scroll-sync.js`、`src/editor/hybrid/image-source.js`、`src/editor/hybrid-markdown.js`、`src/editor/hybrid/widgets.js`。
- Window 测试仍要求 `eventsCloseSavePort.register` 出现在旧位置，而关闭保存已迁移到 Persistence。
- 多个 Stage 8/9 架构测试仍用历史总模块数（例如 381）断言当前 442 项 manifest。
- `tests/architecture/model-kernel-contract.test.mjs:130` 仍要求已拆分的 `src-tauri/src/document_store.rs` 存在并字节不变；这不是本轮发现 Rust 数据格式被破坏的证据。
- 存在真实清单漏项：生产文件 `src/features/documents/application/recent-files-read-source.js` 已由 `documents/index.js` 导出，却未登记于 `production-modules.json`。精确文件集合比较和 inventory collector 均失败；文件从提交 `910be37` 已存在。

**建议**：建立明确的累计测试清单；把当前仍有效的行为、边界和故障测试接入，已迁移测试改为验证新责任所有者；历史计数只对历史快照断言。补齐模块清单并让日常门禁检查精确源码集合。禁止用删除失败测试、全局改成宽松数量比较或只保留已绿子集来消除失败。失败定位清单见附录。

### A03 · P1 · 预览和混合 HTML 缺少不可信内容边界

**位置**：`src/features/preview/render/presentation/presentation-api.js:10–21`；`src/features/preview/render/preview-dom-renderer.js:47–55`；`src/features/preview/render/preview-block-view.js:8–11`；`src/features/hybrid-editor/widgets/html/html-block-view.js:9–12`；`src-tauri/tauri.conf.json` 的 `app.security.csp`。

Markdown 解析结果直接进入 DOM，混合 HTML 块也直接 `template.innerHTML` 后挂载，没有可见的共享净化或隔离步骤；CSP 为 null。使用当前锁定的 marked 解析合成 `<img src="audit-invalid" onerror="globalThis.auditMarker=1">`，输出保留 `onerror` 属性。当前代码没有后续移除步骤。

**判定**：不可信 HTML 注入路径有直接源码和解析输出证据，风险覆盖打开带原始 HTML 的文档及相关预览。是否以及如何在真实 Windows WebView 中执行、能到达哪些原生能力，需要目标环境复验；本轮没有执行桌面利用，也不声称已经验证任意文件读写。历史代码有意保留 HTML 语义，不代表已经建立安全隔离。

**建议**：为预览、混合 HTML、相关导出建立一致且有归属的内容策略，决定净化或隔离呈现方式并保留允许的设计能力；补事件属性、危险 URL、嵌入内容及正常 HTML 回归，再评估 CSP。不得仅在一个入口做替换，也不应在审计授权下擅自改变 HTML 兼容行为。

### A04 · P2 · 日志批次部分提交与整批重试相冲突

**位置**：`src-tauri/src/performance_log.rs:120–130`；`src/runtime/performance.js:180–196`。

后端逐条验证大小并立即 append：前几条可能已落盘，遇到后续超长条目返回错误。前端收到失败后把整个批次放回队首；队列不少于 50 条时，50ms 后再次提交。永久性坏条目可令已写入前缀反复追加，同时阻塞后续日志；目录不可写也会触发密集重试。仅控制台提示去重，没有重试退避。

**证据级别**：由错误返回和重试源码链确认，没有在本轮执行 Rust 磁盘故障注入。该问题早于 R12-14，本轮不假定它由脱敏引入。debug 日志路径适用。

**建议**：明确批次提交/确认语义，写前预检，区分永久性输入错误与暂时 I/O 故障，建立有限退避和坏条目处理；为中途失败、重复写、后续日志恢复提供真实测试。适合在日志 Writer/生命周期任务中独立约束，不能靠吞错解决。

### A05 · P2 · 网页抓取安全规则仍是明确未完成项

**位置**：`src-tauri/src/web_fetch/validation.rs`、`client.rs`、`response.rs:22–42`；阶段任务书 R12-S01。

目前为 30 秒超时和最多 10 次跳转；响应 `.text().await` 没有累计字节/解压后体积上限，Content-Type 只记录不拦截，也没有业务层每跳目标复验。大小写前缀/非 HTTP 输入被 HTTPS 前缀重解释的行为仍保留。大响应内存占用及非预期内容属于现有风险，不是“已安全加固”。

该项此前已明确移交 R12-S01，不能因此宣称 R12-11～13 等价拆分失败，也不能因为它们通过就忽略此项。应先确认上限、类型和重定向策略，再执行真实 HTTP 边界测试；阶段 12 最终收官前必须解决。

### A06 · P2 · 外部文件保存没有内部快照的恢复保障

**位置**：`src-tauri/src/local_file/text_writer.rs:9–11`、`binary_writer.rs:17–20`；对照 `document_store/repository.rs`、`document_store/snapshot/writer.rs`。

用户选择的外部 Markdown/二进制目标直接用 `fs::write` 覆盖，没有临时写入/安全替换步骤。若截断目标后写入失败或进程中断，外部文件可能为空或部分内容。内部文档库使用双槽及原子写流程，其恢复能力不能自动保护这个外部目标。

这是源码确认的故障恢复缺口，不是已复现用户丢失数据，也不是 R12-14 新引入的问题。当前 Writer 测试覆盖成功覆盖与缺失父目录，未覆盖中途写失败保留旧文件。

**建议**：单独确定 Windows 原子替换和失败恢复策略，保留外部文件权限、路径及错误契约，测试磁盘满、占用、替换失败和中断恢复；不能未经验证直接复用带删除回退的替换实现并称为安全完成。

## 4. 已核查且未发现本轮新反证的部分

- 八个冻结 JavaScript 模型文件与 Stage 0 SHA-256 全部一致；Stage 11 到当前 HEAD 的这些文件无 diff。上述模型测试失败源于旧 Rust 文件路径，不应误报为八个模型被改坏。
- 预览调度/取消有明确 channel token 与代次校验；Worker Session 校验 generation、requestId、version，并在销毁/重启时拒绝 pending。可执行相关测试通过的证据保留；不据此保证所有真实大文档性能场景都完成验收。
- Native Save Queue 有每文档串行、版本覆盖、失败传播与销毁处理；Save/Autosave/CloseSave 分工明确，关闭失败不直接默认为允许退出。本轮未定位新的确定性主链丢数据 bug；A06 为外部目标的独立恢复风险。
- Rust 文档存储双槽、完整性校验、journal、上传及命令层保持分层；沿用精确 HEAD 的 Rust CI 证据，不把它扩张为 Windows 崩溃注入验证。
- 本地目录树限制、文件种类、读写及命令职责已拆开；命令列表和冻结兼容契约有现有测试。Windows junction、权限及网络路径真实测试仍不能用 Linux 成功代替。
- 生产依赖未变；Vite 构建和现有体积门禁通过。兼容脚本及全局遥测仍有后续阶段清理计划，当前通过 `verify:no-legacy-runtime` 不代表最终旧链路已清零。

## 5. 验证限制

- 当前执行容器没有 Cargo/rustc；本轮 Rust 结论引用已核对的精确 HEAD Actions 原始日志，未伪称本地重新运行。
- 本机没有 Chromium/Chrome。标准 Browser Contract 和 8 个独立 e2e 文件在启动阶段受阻；尝试下载 Playwright Chromium headless shell 返回无效 ZIP，未绕过环境限制或把失败记为通过。
- 当前标准 CI 的 39 项浏览器检查已经成功，但不等于本轮未启动的 8 个独立 e2e 文件通过，更不等于 A03 的事件脚本复验已完成。
- 当前 Windows native job 仅取 opener 函数指针并 black_box，未覆盖真实文件路径、日志写盘、Tauri GUI、外部文件故障及关闭过程。没有用户 Windows 工作区或运行日志，本轮不能判断其本机未提交修改与实际体验。
- 本次没有 Figma/UI 修改；不据缺失的视觉验收推断设计达标。

## 6. 下一步与恢复依据

1. 保持 R12-14 未通过状态，先修复 A01 并补真实写盘验收。
2. 修复 A02 的累计测试路由、迁移后断言与模块清单；按当前范围建立可证明的回归集合。
3. A03 作为独立安全修复确认 HTML 兼容策略；A04/A06 单独列明恢复策略与验证，不夹带进脱敏修补。
4. R12-14 完整通过后，在有对应实施授权时推进 12.15～17；R12-S01 按既有策略确认要求处理。
5. 本轮没有修改生产行为，回退只需回退本次文档提交。审计依据固定为本页顶部代码提交；后续修复后逐条更新状态，不将旧 CI 冒充修复 HEAD 的验证。

建议顺序不是实施授权；本轮交付为验收裁定和审计报告。

## 附录：可重复执行入口与失败位置

使用完整 Git 历史与锁文件依赖，执行 `npm ci` 后：

```bash
npm test
node --test $(rg --files tests/unit -g '*.test.mjs' | sort)
node --test $(rg --files tests/architecture tests/ui tests/e2e -g '*.test.mjs' | sort)
npm run verify:architecture
npm run verify:no-legacy-runtime
npm run verify:generated-files
npm run verify:readme-record
npm run build
npm audit --json
```

浏览器测试需要先设置有效 `CHROMIUM_PATH`；Windows 环境可使用对应 PowerShell 文件枚举。下面记录本轮实际 runner 的失败位置；e2e 条目为环境阻塞，其余为断言/加载失败，位置只针对审计基准。

- `tests/unit/editor/codemirror-adapter.test.mjs:288:1`：production integration keeps raw CodeMirror confined to the editor feature and removes classic raw-view access
- `tests/unit/editor/codemirror-extension-registry.test.mjs:1:1`：tests/unit/editor/codemirror-extension-registry.test.mjs
- `tests/unit/platform/platform-cutover.test.mjs:12:1`：Atomic Task 3.12 deletes the legacy Tauri facade and removes every native-global caller
- `tests/unit/platform/platform-cutover.test.mjs:37:1`：ESM consumers receive responsibility-focused ports rather than native DTO facade methods
- `tests/unit/platform/window-client.test.mjs:157:1`：save-before-close remains in the application CloseSavePort and stays absent from the platform/window orchestration internals
- `tests/architecture/model-kernel-contract.test.mjs:130:1`：all Stage 0 frozen hashes remain byte-identical
- `tests/architecture/module-inventory.test.mjs:33:1`：production module ownership fixture covers the exact runtime source surface
- `tests/architecture/module-inventory.test.mjs:63:1`：module inventory collector records imports, exports, listeners, state and side-effect signals
- `tests/architecture/stage-06-layout-state.test.mjs:34:1`：all migrated classic callers use the scoped LayoutState port while Atomic 7.14 Preview uses direct LayoutState injection without a second state center
- `tests/architecture/stage-06-layout-state.test.mjs:129:1`：Atomic 6.1 scroll-sync reads resize activity only from LayoutState
- `tests/architecture/stage-06-outline.test.mjs:50:1`：Atomic 6.8 removes classic Outline state/render/parser authority while Atomic 7.14 Preview consumes Outline through direct injection
- `tests/architecture/stage-06-window-controller.test.mjs:33:1`：Atomic 6.13 removes classic Window authority while preserving close-save policy in the application layer
- `tests/architecture/stage-07-preview-legacy-deletion.test.mjs:56:1`：Atomic 7.14 remaining classic callers use the single scoped Preview command surface instead of rebuilding Preview ownership
- `tests/architecture/stage-08-hybrid-activation.test.mjs:52:1`：Atomic 8.3 Activation boundary remains intact after Atomic 8.6 Shared Widget UI extraction
- `tests/architecture/stage-08-hybrid-code-block.test.mjs:91:1`：Atomic 8.8 Code Block ownership remains intact after Atomic 8.9 Table migration
- `tests/architecture/stage-08-hybrid-component-session.test.mjs:52:1`：Atomic 8.2 production inventory records the facade and sole Session state owner
- `tests/architecture/stage-08-hybrid-editor-controller.test.mjs:68:1`：Atomic 8.15 production inventory has final Stage 8 ownership and no legacy aggregate record
- `tests/architecture/stage-08-hybrid-html.test.mjs:69:1`：Atomic 8.13 inventory records the two HTML responsibilities and removes the legacy aggregate
- `tests/architecture/stage-08-hybrid-image.test.mjs:82:1`：Atomic 8.10 Image ownership remains intact after Atomic 8.12 Mermaid migration
- `tests/architecture/stage-08-hybrid-inline-presentation.test.mjs:88:1`：Atomic 8.14 production inventory replaces one aggregate with seven presentation records
- `tests/architecture/stage-08-hybrid-math.test.mjs:81:1`：Atomic 8.11 Math ownership remains intact after Atomic 8.14 Inline Presentation migration
- `tests/architecture/stage-08-hybrid-mermaid.test.mjs:83:1`：Atomic 8.12 Mermaid ownership remains intact after Atomic 8.13 HTML migration
- `tests/architecture/stage-08-hybrid-prefix-hr.test.mjs:73:1`：Atomic 8.7 production inventory keeps the three responsibility-specific Prefix/HR modules after Atomic 8.14
- `tests/architecture/stage-08-hybrid-shared-widget-ui.test.mjs:63:1`：Atomic 8.6 Shared Widget UI boundary remains intact after Atomic 8.10 Image migration
- `tests/architecture/stage-08-hybrid-source-edit-controller.test.mjs:61:1`：Atomic 8.4 production inventory records the new responsibility boundaries
- `tests/architecture/stage-08-hybrid-table.test.mjs:89:1`：Atomic 8.9 Table ownership remains intact after Atomic 8.12 Mermaid migration
- `tests/architecture/stage-08-hybrid-widget-lifecycle.test.mjs:72:1`：Atomic 8.5 lifecycle boundary remains intact after Atomic 8.10 Image migration
- `tests/architecture/stage-09-editor-scroll-mapper.test.mjs:73:1`：R9-04 inventory records one editor mapper and final Stage 9 cardinality
- `tests/architecture/stage-09-final-sync-legacy-removal.test.mjs:92:1`：R9-12 production inventory removes classic scroll-sync, replaces old controller path and contains the final sync modules exactly once
- `tests/architecture/stage-09-preview-scroll-mapper.test.mjs:83:1`：R9-05 inventory records preview mapper and final Stage 9 cardinality
- `tests/architecture/stage-09-scroll-contract-freeze.test.mjs:60:1`：current inventory records final public Sync owners without restoring obsolete controllers
- `tests/architecture/stage-09-scroll-controller.test.mjs:71:1`：R9-03 inventory records the canonical controller and source owner in final Stage 9 topology
- `tests/architecture/stage-09-scroll-geometry-session.test.mjs:75:1`：R9-06 inventory records one geometry owner and final Stage 9 cardinality
- `tests/architecture/stage-09-scroll-source-ownership.test.mjs:68:1`：R9-02 inventory records one source owner and final Stage 9 cardinality
- `tests/architecture/stage-09-selection-feedback-guard.test.mjs:75:1`：R9-08 production inventory records one Feedback Guard responsibility and final Stage 9 cardinality
- `tests/architecture/stage-09-selection-highlight-session.test.mjs:75:1`：R9-09 production inventory records one Highlight Session responsibility and final Stage 9 cardinality
- `tests/architecture/stage-09-selection-readers.test.mjs:92:1`：R9-07 production inventory records exactly two Reader responsibilities and final Stage 9 cardinality
- `tests/architecture/stage-09-selection-retry-scheduler.test.mjs:83:1`：R9-10 production inventory records one Retry Scheduler owner and final controller remains a distinct orchestration owner
- `tests/e2e/preview-enhancement-coordinator.test.mjs:1:1`：tests/e2e/preview-enhancement-coordinator.test.mjs
- `tests/e2e/preview-focus-controller.test.mjs:1:1`：tests/e2e/preview-focus-controller.test.mjs
- `tests/e2e/preview-layout-stability.test.mjs:1:1`：tests/e2e/preview-layout-stability.test.mjs
- `tests/e2e/preview-recovery-view.test.mjs:1:1`：tests/e2e/preview-recovery-view.test.mjs
- `tests/e2e/preview-virtual-window.test.mjs:1:1`：tests/e2e/preview-virtual-window.test.mjs
- `tests/e2e/recent-files-menu.test.mjs:1:1`：tests/e2e/recent-files-menu.test.mjs
- `tests/e2e/submenu-positioner.test.mjs:1:1`：tests/e2e/submenu-positioner.test.mjs
- `tests/e2e/window-controller.test.mjs:1:1`：tests/e2e/window-controller.test.mjs
- `tests/ui/style-layering.test.mjs:121:1`：stable compatibility presentation has no inline style authority
