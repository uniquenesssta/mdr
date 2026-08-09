# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.1 PASS：新增 metadata-only Documents Domain，统一 ID/标题/路径/时间/native/最近文件元数据并切换 classic 调用者；保留历史 localStorage 宽容语义，冻结 DocumentModel 未修改。5.1、Architecture、Node、Browser、Build、Built App 全通过；依赖/锁文件未变。
