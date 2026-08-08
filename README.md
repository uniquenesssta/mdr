# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 3.12 本地验收通过：专项 6/6、Platform 135/135、架构四门禁、Node 42/42、Browser 10/10 + 12/12、Vite build、evidence、`npm audit` 0；Stage 3 Atomic CI 通过。Windows native CI 的 release/driver 构建通过，但 WebDriver 会话报 `No window could be found`，故 Stage 3 暂不标记 PASS；未改 Rust、依赖或锁文件。
