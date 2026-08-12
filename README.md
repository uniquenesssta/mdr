# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整记录见 [docs/README.md](docs/README.md)，6.8 见 [验收记录](docs/rewrite-progress/stage-06/06-08-outline.md)。

2026-08-12：Atomic 6.8 已将 Outline 拆为索引树、折叠状态、active heading、View 与 Controller；只消费既有标题索引，不重复解析全文。6.9 Folder Tree 未开始。