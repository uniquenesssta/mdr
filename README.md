# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 4.3 已实施：新增 DOM/storage-free I18n Service，统一 locale state、`t()`/格式化/fallback/切换事件/销毁；classic 调用改用 scoped I18n port，并修复保存语言启动路径。4.4 DOM bindings 与 4.5 Help 未提前实施。候选验证待 clean CI；未改 Rust、依赖或锁文件。
