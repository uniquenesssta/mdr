# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整记录见 [docs/README.md](docs/README.md)，Atomic 5.9 详见 [验收记录](docs/rewrite-progress/stage-05/05-09-editor-history-adapter.md)。

2026-08-10：CR-01～CR-05 PASS；Atomic 5.9 PASS。Editor History Adapter 仅代理 CodeMirror undo/redo/isolate，classic 全文 `historyStack` 与重复 reset-history 路径已删除；Frozen DocumentModel、持久化、依赖与运行行为保持不变。Atomic 5.10 尚未开始。