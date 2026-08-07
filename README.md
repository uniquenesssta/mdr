# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-07：Atomic 3.9 PASS。Web、Link、PerformanceLog 三个 desktop client 已独立接管剩余 native 命令，旧 runtime 直接 invoke=0；Windows 验证：专项 16/16、架构门禁、Node 42/42、浏览器 10/10+12/12、build、evidence 均通过，npm audit 0。未改 Rust、依赖或锁文件。
