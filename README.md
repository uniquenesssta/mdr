# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.1 PASS：新增 metadata-only Documents Domain，统一文档 ID、标题、路径、更新时间、native 元数据与最近文件条目；classic core/native store 已切换到公开 Documents 契约，冻结 DocumentModel 未修改。Atomic 5.1、architecture、Node、Browser Contract、build、Built App 全通过；依赖/锁文件未变。
