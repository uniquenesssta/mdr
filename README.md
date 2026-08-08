# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 4.9 已实现 Section Modules：general/editor/save/toolbar/performance 已拆为不可变字段描述，完整覆盖 15 项 Settings Schema；13 项保持 Settings Dialog 暴露，table/code visual editing 两项保持 external。Section 不访问 DOM/storage/业务模块；4.10 未开始，完整 Stage 4 门禁待官方 CI；未改 Rust、依赖或 lockfile。
