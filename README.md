# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-12：删除 classic scroll-sync 与旧 Selection Controller；最终 Sync 仅用模块化 Mapper/Controller、frozen mapping 和显式能力，移除文本搜索/全文 editor.value fallback 与 Sync window globals。验证待权威 CI 完成后记录。

R9-12 验证诊断：historical regression 临时 CI 已将原有 R9-11～R9-01 与 Stage 8 同一测试集合拆为独立命名门禁，以精确定位现存失败；未删除、跳过或弱化任何测试。R9-11 已进一步拆为 direct frozen contract 与 architecture integration 两个子检查，其中 direct 4/4 PASS；architecture 5/6，唯一失败来自测试将控制器错误消息字符串 `frozen selectionMappingApi` 误判为非法代码引用。该架构断言已收窄为检查真实运行时代码引用和 direct import，不修改生产错误语义、冻结 mapping 或注入链。R9-10 及之后门禁仍按硬失败停止，修正后的权威结果待最新 CI 记录。