# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-12：删除 classic scroll-sync 与旧 Selection Controller；最终 Sync 仅用模块化 Mapper/Controller、frozen mapping 和显式能力，移除文本搜索/全文 editor.value fallback 与 Sync window globals。验证待权威 CI 完成后记录。

R9-12 验证诊断：historical regression 临时 CI 已将原有 R9-11～R9-01 与 Stage 8 同一测试集合拆为独立命名门禁，以精确定位现存失败；未删除、跳过或弱化任何测试。已确认 R9-11 direct frozen contract 4/4 PASS、architecture integration 6/6 PASS；R9-10 16/16 PASS；R9-09 16/16 PASS；R9-08 16/16 PASS；R9-07 15/15 PASS；R9-06 14/14 PASS；R9-05 historical regression 16/16 PASS。R9-11 architecture 误报已收窄为检查真实运行时代码引用和 direct import，生产错误语义、冻结 mapping 与注入链均未修改。R9-10 历史测试已改为验证 Retry Scheduler 独占重试替换/取消职责，生产 Scheduler/Controller 未修改。

R9-05 production cleanup：修复前 historical regression 为 15/16，唯一失败来自 `main.js` teardown 残留的 `compatibilityPlatformHost.markdownEditorPreviewScrollMapper` 死清理。R9-12 已在创建路径删除该 compatibility host 暴露；修复仅删除对应不可达 delete 分支，保留 `PreviewScrollMapper.destroy()` 与 teardown 顺序不变，不改 Preview 映射算法、虚拟高度能力、滚动策略或用户可观察行为。candidate CI 在提交 `a87bf0cc5b8d220705ee71e24467a2bc4bbfd3bf` 前实际完成 R9-12 targeted 16/16 PASS、`npm run build` PASS、`npm ci` 0 vulnerabilities；随后 historical regression 已确认 R9-05 16/16 PASS。

R9-04 production cleanup：修复前 historical regression 为 13/14，唯一失败来自仍暴露在 `compatibilityPlatformHost.markdownEditorEditorScrollMapper` 的旧 EditorScrollMapper compatibility 状态。六个实际加载的 classic 模块及 candidate 的 `src/`/`public/` 全生产树扫描均确认除 `src/main.js` 外无消费者；提交 `b112913968e573f2ebd8e7d12952460ea81e71bd` 删除该 host 赋值及对应 delete 清理，保留通过 Sync public factory 创建、显式注入 Selection/Scroll 链和 `EditorScrollMapper.destroy()` 生命周期不变，不改 CodeMirror 几何读取、frozen model line-range、滚动算法或用户可观察行为。提交前 candidate 实际完成 R9-04 14/14 PASS、R9-05 16/16 PASS、R9-12 targeted 16/16 PASS、`npm run build` PASS、`npm ci` 0 vulnerabilities；R9-04 historical regression 仍待本次正常提交触发后的权威结果，硬失败继续阻止 R9-03 及后续门禁。

R9-04 production cleanup：全生产树扫描确认 `markdownEditorEditorScrollMapper` 除 `src/main.js` 外无任何消费者；本补丁删除 EditorScrollMapper 向 `compatibilityPlatformHost` 的遗留暴露及对应 delete 清理，保留通过 Sync public factory 创建、显式注入 Selection/Scroll 链和 `EditorScrollMapper.destroy()` 生命周期不变。该修改不改 CodeMirror 几何读取、frozen model line-range、滚动算法或用户可观察行为；R9-04/R9-05/R9-12 targeted 与 build 由 candidate CI 在提交前验证。
