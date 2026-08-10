# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整记录见 [docs/README.md](docs/README.md)。

2026-08-10：Stage 5 / Atomic 5.8 发布候选。Editor Controller 按任务书落位 `src/features/editor/`，连接冻结 DocumentModel 与 editor adapter；classic 整正文写入改经 Controller，生产模块 257→260，无依赖变化。正式结论以远端 CI 为准。
