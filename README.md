# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-12：删除 classic scroll-sync 与旧 Selection Controller；最终 Sync 仅用模块化 Mapper/Controller、frozen mapping 和显式能力，移除文本搜索/全文 editor.value fallback 与 Sync window globals。验证待权威 CI 完成后记录。

R9-12 historical regression：R9-11 direct 4/4 PASS、R9-11 architecture 6/6 PASS、R9-10 16/16 PASS、R9-09 16/16 PASS、R9-08 16/16 PASS、R9-07 15/15 PASS、R9-06 14/14 PASS、R9-05 16/16 PASS、R9-04 14/14 PASS、R9-03 13/13 PASS、R9-02 13/13 PASS、R9-01 13/13 PASS；Stage 8 regression 179/179 PASS。R9-11/R9-10/R9-02 的历史架构测试已分别收窄到真实运行时代码引用、Retry Scheduler 独占替换职责与注入式 ScrollSourceOwnership 契约；对应生产实现与 frozen selection mapping 未为测试改动。

R9-05 production cleanup：修复前 historical regression 为 15/16，唯一失败来自 `main.js` teardown 残留的 `compatibilityPlatformHost.markdownEditorPreviewScrollMapper` 死清理。R9-12 已在创建路径删除该 compatibility host 暴露；修复仅删除对应不可达 delete 分支，保留 `PreviewScrollMapper.destroy()` 与 teardown 顺序不变，不改 Preview 映射算法、虚拟高度能力、滚动策略或用户可观察行为。candidate CI 在提交 `a87bf0cc5b8d220705ee71e24467a2bc4bbfd3bf` 前实际完成 R9-12 targeted 16/16 PASS、`npm run build` PASS、`npm ci` 0 vulnerabilities；historical regression 后续确认 R9-05 16/16 PASS。

R9-04 production cleanup：修复前 historical regression 为 13/14，唯一失败来自 `compatibilityPlatformHost.markdownEditorEditorScrollMapper` 遗留暴露。六个实际加载的 classic 模块及 candidate 的 `src/`/`public/` 全生产树扫描均确认除 `src/main.js` 外无消费者；提交 `b112913968e573f2ebd8e7d12952460ea81e71bd` 删除该 host 赋值及对应 delete 清理，保留通过 Sync public factory 创建、显式注入 Selection/Scroll 链和 `EditorScrollMapper.destroy()` 生命周期不变，不改 CodeMirror 几何读取、frozen model line-range、滚动算法或用户可观察行为。提交前 candidate 实际完成 R9-04 14/14 PASS、R9-05 16/16 PASS、R9-12 targeted 16/16 PASS、`npm run build` PASS、`npm ci` 0 vulnerabilities；historical regression 后续确认 R9-04 14/14 PASS。

Stage 8 regression：Atomic 8.5 Widget Geometry Scheduler 的两处历史测试已从旧 `markdownEditorScrollSync`/`markdownEditorSelectionController` globals 适配到 R9-12 最终 `hybrid-sync-capabilities` 显式注入边界；生产 Scheduler 未修改。candidate 已实际验证 Atomic 8.5 10/10 PASS、R9-04 14/14 PASS、R9-05 16/16 PASS、R9-12 targeted 16/16 PASS、`npm run build` PASS、`npm ci` 0 vulnerabilities；完整 historical regression 已确认 Stage 8 179/179 PASS。

R9-12 impact inventory：先前红灯并非库存漂移；`.agent/r9_12_inventory.sh` 重新生成日志后工作区为 clean，失败来自旧 workflow 在无变化时仍强制执行 `git commit`，Git 返回 `nothing to commit`/exit 1。inventory workflow 已改为纯验证：重新生成日志后执行 `git diff --check` 与 `git diff --exit-code`，无差异即 PASS、有差异即 FAIL；已移除自动 commit/push 与 contents write 权限。修正后的 inventory 结果待最新 CI 确认。
