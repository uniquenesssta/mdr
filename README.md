# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-07：Atomic 3.10 六个 Browser adapter 已实现。Windows 已通过架构门禁、Node 42/42、浏览器 10/10+12/12、build、evidence、audit 0；Platform 单元为 113/114，唯一失败确认是 Print 边界测试误把 ESM `export` 关键字当业务逻辑，已修正测试，待重跑确认。未改生产实现、Rust、依赖或锁文件。
