# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 4.8 PASS：Settings Store 已成为唯一运行时设置状态所有者，committed snapshot 与 draft 会话分离；Cancel/Escape/Backdrop 零持久化，apply/立即提交均持久化成功后才推进状态。4.1–4.8、architecture、Node、Browser Contract、build、Built App Browser 与 evidence 全部通过。4.9 未开始；未改 Rust、依赖或 lockfile。
