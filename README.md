# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 3.12 本地验收全通过；Windows Native 唯一阻塞定位为 isolated WebDriver host 与生产共用 Cargo target。现已恢复为两个独立的仓库外 target，保持轻量化与构建隔离；待真实 Windows maximize/resize/drag/close 回归。未改生产 Rust、依赖或锁文件。
