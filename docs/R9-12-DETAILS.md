# R9-12 最终同步收口记录

本文记录 R9-12 已实际实施、实际验证及最终门禁事实。项目级架构与长期 Change Log 仍由 `docs/README.md` 承担；根 `README.md` 只作为 120–360 字符的简洁项目入口。

## 实施结果

R9-12 已删除 classic `public/app/scroll-sync.js` 与旧 `src/sync/selection-controller.js`，最终 Sync 生产链仅使用模块化 Mapper/Controller、frozen selection mapping 与显式能力注入。文本搜索/全文 `editor.value` fallback 和 Sync `window.*` 业务全局已移除；冻结 `src/sync/selection-mapping.js`、`src/model-kernel/index.js`、`src/document/document-model.js` 以及 `package.json` / `package-lock.json` 均保持 R9-12 基线不变。

R9-05 production cleanup 已移除 `main.js` teardown 中不可达的 `compatibilityPlatformHost.markdownEditorPreviewScrollMapper` 清理分支；保留 `PreviewScrollMapper.destroy()` 与既有 teardown 顺序，不改变 Preview 映射算法、虚拟高度能力、滚动策略或用户可观察行为。R9-04 production cleanup 已移除 `compatibilityPlatformHost.markdownEditorEditorScrollMapper` 遗留暴露及对应不可达 delete 清理；保留 Sync public factory、显式注入 Selection/Scroll 链和 `EditorScrollMapper.destroy()` 生命周期，不改变 CodeMirror 几何读取、frozen model line-range、滚动算法或用户可观察行为。

Stage 8 Atomic 8.5 Widget Geometry Scheduler 的两处历史测试已从旧 `markdownEditorScrollSync` / `markdownEditorSelectionController` globals 适配到 R9-12 最终 `hybrid-sync-capabilities` 显式注入边界；生产 Scheduler 未修改。Stage 1/Stage 8 的架构历史测试也已区分“历史交接证据”和“当前精确迁移债务”：历史 Stage 1 的 67 modules / 9 classic scripts / 38 business globals 记录继续冻结，当前 architecture baseline 则只记录仍真实存在的 6 classic scripts / 43 inline events / 9 business globals，并显式断言已删除的 `scroll-sync.js` 与三个 Sync globals 不得回归。

## 历史回归

R9-11 direct 4/4 PASS、R9-11 architecture 6/6 PASS、R9-10 16/16 PASS、R9-09 16/16 PASS、R9-08 16/16 PASS、R9-07 15/15 PASS、R9-06 14/14 PASS、R9-05 16/16 PASS、R9-04 14/14 PASS、R9-03 13/13 PASS、R9-02 13/13 PASS、R9-01 13/13 PASS；Stage 8 regression 179/179 PASS。对应生产实现与 frozen selection mapping 未为历史测试改写，失败测试没有被删除、跳过或弱化。

## Inventory 与 CI 门禁

`.agent/r9_12_inventory.sh` 现在只生成确定性的 `.agent/r9_12_inventory.txt`。旧 workflow 曾在无变化时强制 `git commit`，导致 `nothing to commit` / exit 1；现有 inventory workflow 仅重新生成快照并执行 `git diff --check` 与 `git diff --exit-code`，无差异 PASS、有差异 FAIL，不再自动 commit/push，也不再申请 contents write 权限。

权威 full validation 使用 Ubuntu 24.04 + 项目 Node 22，包含 R9-12 scope/frozen/package、381 production modules、`npm audit --audit-level=high`、R9-12 targeted、全量 Node、Architecture / no-legacy-runtime / generated-files / README record、Browser contract、production build、Built-app Browser 双轮以及最终 tracked tree clean 门禁。CI 中 Browser summary 的断言已同步到测试 runner 实际输出格式；测试本身及通过标准没有被降低。

以代码/CI 验证提交 `e9e273e3c13c6367dbdbbc38412d62471297aff2` 为准，四条硬验证链均已通过：

- impact inventory run `32032269039`：PASS。
- historical regression run `32032269104`：PASS。
- candidate integration run `32032269056`：PASS。
- authoritative full validation run `32032269071`：PASS；R9-12 scope/frozen/package/381 modules PASS，`npm ci` 与 `npm audit --audit-level=high` 均为 0 vulnerabilities，R9-12 targeted 16/16 PASS，Full Node 235/235 PASS，Architecture / no-legacy-runtime / generated-files / README record 全部 PASS，Browser contract 10/10 PASS，production build PASS，Built-app Browser 29/29 连续两轮 PASS，最终 tracked tree clean PASS。

GitHub hosted runner 同时输出一条平台维护警告：`actions/checkout@v4` 与 `actions/setup-node@v4` 的 action runtime 仍声明 Node 20，当前 runner 已强制以 Node 24 执行；本次所有门禁均通过，未影响 R9-12 结果。该警告属于后续 CI action 版本维护事项，不属于本阶段生产代码失败。

## 文档职责

- 根 `README.md`：简洁项目介绍和文档入口，满足既有 120–360 字符 architecture contract。
- `docs/README.md`：项目级架构说明、长期 Change Log、阶段索引与 canonical markers。
- `docs/R9-12-DETAILS.md`：R9-12 的完整实施边界、兼容性、验证证据和已知 CI 维护提示，避免把全部阶段细节继续堆入根 README。
