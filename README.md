# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.4 PASS：RecentFilesRepository 接管最近文件上限、大小写无关去重、序列化与清空，菜单 DOM 仍归 UI；5.1–5.4、冻结 DocumentModel、Architecture、Node、Browser、Build、Built App 全通过，生产模块 250→252，依赖/锁文件未变。