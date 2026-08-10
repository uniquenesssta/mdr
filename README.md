# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整记录见 [docs/README.md](docs/README.md)，5.11 详见 [验收记录](docs/rewrite-progress/stage-05/05-11-editor-find-replace.md)。

2026-08-10：CR-01～CR-05、Atomic 5.11 PASS。Find/Replace 已收敛到 Editor Command Service，局部检索、单事务替换并保留 native 大文档搜索端口；Frozen DocumentModel、持久化、依赖和现有 UI 行为不变；5.12 未开始。