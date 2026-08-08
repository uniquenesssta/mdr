# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 4.3 PASS：新增 DOM/storage-free I18n Service，统一 locale state、`t()`/格式化/fallback/切换事件/销毁；classic 调用切至 scoped I18n port，并修复保存语言启动路径。clean CI：4.1/4.2/4.3 各 7/7、Node 42/42、Browser 10/10+12/12、architecture/build/evidence PASS。未改 Rust、依赖或锁；4.4 未开始。
