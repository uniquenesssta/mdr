# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.6 PASS：CodeMirror Extension Registry 集中基础、Markdown、主题、只读与 Hybrid 扩展槽，运行时变化统一经 Compartment 重配；`virtual-editor` 不再持有扩展装配状态。5.1–5.6 与全量门禁通过，生产模块 254→255，冻结 DocumentModel、依赖与锁文件未变。