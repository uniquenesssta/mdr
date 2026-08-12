# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整记录见 [docs/README.md](docs/README.md)，6.9 见 [验收记录](docs/rewrite-progress/stage-06/06-09-folder-tree.md)。

2026-08-12：Atomic 6.9 已将 Folder Tree 拆为路径策略、规范化、状态、Controller、Tree/Node View；文件读取只走 FilesPort，旧全局与单文件实现已移除。6.10 未开始。