# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 3.12 本地与 Stage 3 Atomic 全通过；Windows Native 已恢复独立 WebDriver target，session attach 已成功。现修复首屏 Help Modal 与异步 init 的竞态：等待 `__markdownEditorInitPromise` 后再经正常 UI 关闭；待真实 maximize/resize/drag/close 回归。未改生产 Rust、依赖或锁文件。
