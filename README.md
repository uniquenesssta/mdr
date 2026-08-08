# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 4.2 PASS：删除 `public/i18n.js`，拆为 10 locale + registry（161 键一致）；8 locale 的 2 个缺失键沿用旧 zh-CN fallback，`helpHtml` SHA 不变并独立保留待 4.5。clean CI `31240400556`：4.1/4.2 各 7/7、Node 42/42、Browser 10/10+12/12、architecture/build/evidence PASS。未改 Rust、依赖或锁；4.3 未开始。
