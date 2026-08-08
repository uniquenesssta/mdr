# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Atomic 4.10 PASS：Settings UI 已迁入独立模块，13 项 Dialog 字段由 Section descriptors 驱动；Apply/Cancel、目录、颜色、自动保存及 ModalShell 生命周期已验证，旧静态 Settings Modal/inline handlers 已退出。4.1–4.10、architecture、Node 42/42、Browser Contract 10/10、build、Built App 15/15 全绿；4.11 未开始。