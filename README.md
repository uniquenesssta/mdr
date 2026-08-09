# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.3 PASS：DocumentSessionController 接管文档生命周期编排并以 generation 阻止 stale 异步回写；SessionDocumentRepository 接管正文兼容持久化，classic 旧编排与缓存退出。5.1–5.3、冻结 DocumentModel、Architecture、Node、Browser、Build、Built App 全通过；生产模块 244→250，依赖/锁文件未变。