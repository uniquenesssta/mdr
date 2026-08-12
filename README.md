# Markdown Editor

简介：本仓库是模块化重写中的桌面 Markdown 编辑器；范围与权威导航见 [docs/README.md](docs/README.md)。

Atomic 7.1 已完成预览行为阈值冻结：字符、块、调度、虚拟窗口与章节阈值由 `src/features/preview/pipeline/preview-thresholds.js` 单一拥有，classic 与现有 Preview 模块只读消费。完整候选链 PASS；冻结模型、持久化、Rust、依赖未改，Atomic 7.2 尚未开始。
