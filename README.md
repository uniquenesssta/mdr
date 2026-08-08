# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 4.8 已实现 Settings Store：唯一拥有已验证 committed snapshot 与单一 draft 会话，区分 open/apply/cancel；Cancel/Escape/Backdrop 均只丢弃 draft、不写 Repository。4.9 未开始；完整阶段门禁待验证，未改 Rust、依赖或 lockfile。
