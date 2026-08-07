# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-07：Atomic 3.9 已拆分 Web、Link、PerformanceLog 三个独立 desktop client，旧 runtime 不再直接调用 invoke；URL/外链安全/日志队列策略仍由既有业务与 Rust 权威实现。命令字段、错误和兼容 fallback 不变。当前提交待 Stage 3 与 Windows 回归验证；未改 Rust、依赖或锁文件。
