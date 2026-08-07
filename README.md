# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-07：依赖读取位于父目录：Node `../node_modules`，Vite 缓存位于其下，Cargo target `../.cargo-target/markdown-editor`，Windows 自动化宿主同样外置。Stage 0/1/2/3 与 Windows 原生窗口回归通过。Windows 测试已统一处理 CRLF 与 npm CLI 启动，避免文档和架构门禁误报。
