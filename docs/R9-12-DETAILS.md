# R9-12 最终同步收口记录

本文只记录 R9-12 已实际实施、已实际验证或当前仍被门禁阻塞的事实；项目级长期记录仍以 `docs/README.md` 为索引与 Change Log 入口。

## 实施结果

R9-12 已删除 classic `public/app/scroll-sync.js` 与旧 `src/sync/selection-controller.js`，最终 Sync 生产链仅使用模块化 Mapper/Controller、frozen selection mapping 与显式能力注入。文本搜索/全文 `editor.value` fallback 和 Sync `window.*` 业务全局已移除；冻结 `src/sync/selection-mapping.js`、模型入口、文档模型以及 package 边界保持不变。

R9-05 production cleanup 已移除 `main.js` teardown 中不可达的 `compatibilityPlatformHost.markdownEditorPreviewScrollMapper` 清理分支；保留 `PreviewScrollMapper.destroy()` 与既有 teardown 顺序，不改变 Preview 映射算法、虚拟高度能力、滚动策略或用户可观察行为。对应候选验证曾实际完成 R9-05 16/16、R9-12 targeted 16/16、`npm run build` PASS、`npm ci` 0 vulnerabilities。

R9-04 production cleanup 已移除 `compatibilityPlatformHost.markdownEditorEditorScrollMapper` 遗留暴露及对应不可达 delete 清理；保留 Sync public factory、显式注入 Selection/Scroll 链和 `EditorScrollMapper.destroy()` 生命周期，不改变 CodeMirror 几何读取、frozen model line-range、滚动算法或用户可观察行为。对应候选验证曾实际完成 R9-04 14/14、R9-05 16/16、R9-12 targeted 16/16、`npm run build` PASS、`npm ci` 0 vulnerabilities。

Stage 8 Atomic 8.5 Widget Geometry Scheduler 的两处历史测试已从旧 `markdownEditorScrollSync` / `markdownEditorSelectionController` globals 适配到 R9-12 最终 `hybrid-sync-capabilities` 显式注入边界；生产 Scheduler 未修改。完整 historical regression 已确认 Stage 8 179/179 PASS。

## 历史回归

R9-11 direct 4/4 PASS、R9-11 architecture 6/6 PASS、R9-10 16/16 PASS、R9-09 16/16 PASS、R9-08 16/16 PASS、R9-07 15/15 PASS、R9-06 14/14 PASS、R9-05 16/16 PASS、R9-04 14/14 PASS、R9-03 13/13 PASS、R9-02 13/13 PASS、R9-01 13/13 PASS；Stage 8 regression 179/179 PASS。R9-11/R9-10/R9-02 的历史架构测试已分别收窄到真实运行时代码引用、Retry Scheduler 独占替换职责与注入式 ScrollSourceOwnership 契约；对应生产实现与 frozen selection mapping 未为测试改动。

## Inventory 与 CI 门禁

`.agent/r9_12_inventory.sh` 重新生成日志后工作树可保持 clean。旧 workflow 曾在无变化时强制执行 `git commit`，导致 `nothing to commit` / exit 1；inventory workflow 已改为纯验证：重新生成日志后执行 `git diff --check` 与 `git diff --exit-code`，无差异 PASS、有差异 FAIL，并移除自动 commit/push 与 contents write 权限。提交 `98677c10fb220936889498acf7f2faff6abcf4c6` 触发的 impact inventory 已实际 PASS。

权威 full validation 使用 Node 22 / Ubuntu 24.04，包含 `npm audit --audit-level=high`、全量 Node、Architecture、Browser contract 10/10、build、Built-app Browser 29/29 双轮，以及 R9-12 scope/frozen/package、381 production modules、no-legacy-runtime、generated-files、README record 和验证后 tracked tree clean 门禁。

截至分支提交 `19069afceef9d1c5a18ea811d3ba90efea441378`：impact inventory、historical regression、candidate integration 均 PASS；authoritative full validation run `32030411585` 在 Full Node regression 阶段真实 FAIL，因此 Architecture/Browser/build/Built-app 后续硬门禁被阻断而未执行。已暴露的两处 Full Node 失败为：`tests/documentation-layout.test.mjs` 检查根 `README.md` 必须为 120–360 字符的简洁入口；`tests/package-scripts.test.mjs` 中 `verify:architecture` 返回失败。前者按现有文档布局契约修复，后者必须继续定位真实架构失败，禁止通过删除、跳过或弱化测试绕过。

## 文档职责

- 根 `README.md`：仅保留 120–360 字符的项目简介和文档入口，满足既有 architecture contract。
- `docs/README.md`：保留项目级架构说明、Change Log、阶段索引与既有 canonical markers。
- `docs/R9-12-DETAILS.md`：承载本阶段完整实施边界、兼容性、验证证据和未通过门禁，避免根 README 因历史记录无限膨胀。
