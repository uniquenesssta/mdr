# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-12：删除 classic scroll-sync 与旧 Selection Controller；最终 Sync 仅用模块化 Mapper/Controller、frozen mapping 和显式能力，移除文本搜索/全文 editor.value fallback 与 Sync window globals。验证待权威 CI 完成后记录。

R9-12 验证诊断：historical regression 临时 CI 已将原有 R9-11～R9-01 与 Stage 8 同一测试集合拆为独立命名门禁，以精确定位现存失败；未删除、跳过或弱化任何测试。权威结果待分步 CI 完成后记录。