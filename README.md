# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-07：依赖继续读取父目录。Atomic 3.6 已新增独立 DragDrop client：统一 Tauri 拖放事件为不可变平台事件并管理幂等退订；文件类型判断仍由应用层负责，旧 `markdownEditorNative.onDragDrop` 兼容形状不变。当前提交待 Stage 3 与全量回归验证。
