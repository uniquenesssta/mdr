# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Atomic 4.11 PASS：Theme Service 与独立 Theme Toggle Controller 已接管提交态主题切换；旧 classic setAppTheme/toggleTheme 权威退出，主题通过 Settings 提交事件应用到 data-theme，切换不重建 editor/model/preview。4.1–4.11、architecture、Node、Browser Contract、build、Built App 均通过；未改依赖或锁文件，4.12 未开始。
