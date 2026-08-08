# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Atomic 4.10 PASS：Settings UI 已迁入独立 application/ui 模块，13 项 Dialog 字段由 4.9 Section descriptors 单一驱动；导航、draft 编辑、Apply/Cancel、颜色/自动保存/目录字段及 ModalShell 生命周期均已切换，旧静态 Settings Modal/inline handlers 已退出。4.1–4.10、architecture、Node 42/42、Browser Contract 10/10、build、Built App 15/15 均通过；未改依赖或锁文件，4.11 未开始。