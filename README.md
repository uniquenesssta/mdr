# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 4.2 已实施：`public/i18n.js` 拆为 10 个短文本 locale 模块 + registry，161 键一致；8 locale 的 2 个缺失键按原 zh-CN fallback 显式物化，`helpHtml` 原样迁出等待 4.5。候选 CI：4.1 7/7、4.2 7/7、Node 42/42、Browser 10/10+12/12、architecture/build/evidence PASS。未改 Rust、依赖或锁文件；待 clean commit 复验。
