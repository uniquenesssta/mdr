# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-12：删除 classic scroll-sync 与旧 Selection Controller；最终 Sync 仅用模块化 Mapper/Controller、frozen mapping 和显式能力，移除文本搜索/全文 editor.value fallback 与 Sync window globals。验证待权威 CI 完成后记录。

R9-12 验证诊断：historical regression 临时 CI 已将原有 R9-11～R9-01 与 Stage 8 同一测试集合拆为独立命名门禁，以精确定位现存失败；未删除、跳过或弱化任何测试。R9-11 direct frozen contract 4/4 PASS、architecture integration 6/6 PASS；此前 architecture 误报已收窄为检查真实运行时代码引用和 direct import，生产错误语义、冻结 mapping 与注入链均未修改。R9-10 上一轮为 14/16，两个失败均由历史测试写死旧 Controller 细节导致：architecture 不再要求泛型 `assertMethods` 展开成固定错误字符串；direct 生命周期测试改为验证新 editor 调度、clear、stop 三个 Controller 边界分别取消旧重试，同时明确再次 retry 的旧任务替换由 `SelectionRetryScheduler.schedule()` 内部 `cancelPending()` 独占。生产 Scheduler/Controller 未修改。修正后的 R9-10 权威结果待最新 CI 记录，硬失败仍阻止后续门禁。

R9-05 production cleanup：R9-12 已在创建路径移除 `compatibilityPlatformHost.markdownEditorPreviewScrollMapper` 暴露，但 teardown 仍残留对应的不可达 delete 分支；本补丁仅删除该死兼容清理，保留 `PreviewScrollMapper.destroy()` 与 teardown 顺序不变。该修复不改 Preview 映射算法、虚拟高度能力、滚动策略或用户可观察行为；targeted R9-12 与 build 由 candidate CI 在提交前执行。
