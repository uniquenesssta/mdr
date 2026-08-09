# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.2 PASS：DocumentSessionStore 接管 metadata-only 文档记录、activeId 与会话事件；classic core/export/preview 已切换显式 Session Port，NativeDocumentStore 不再修改记录；正文未进入 Store，冻结 DocumentModel 未修改。5.1–5.2、Architecture、Node、Browser、Build、Built App 全通过；依赖/锁文件未变。
