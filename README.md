# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 4.7 已实现 Settings Repository：15 项设置的持久化 I/O 已收敛到 schema 驱动 Repository，旧 key 保持；读取失败/非法值不回写，写入失败执行回滚。4.7 定向与阶段门禁待验证；4.8 未开始，未改 Rust、依赖或 lockfile。
