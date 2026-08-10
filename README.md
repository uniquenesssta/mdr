# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整记录见 [5.8 验收](docs/rewrite-progress/stage-05/05-08-editor-controller.md)。

2026-08-10：Stage 5 / Atomic 5.8 PASS。Editor Controller 按任务书落位 `src/features/editor/`，DocumentModel 保持正文唯一权威；classic 整正文写入经 Controller。生产模块 257→260；架构、Node、Browser、Build、Built App 全部 PASS，无依赖变化。
