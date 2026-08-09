# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.5 PASS：CodeMirror Adapter 私有化 state/view，统一文本、事务、选择、焦点、滚动、历史、订阅与销毁；其他 feature 不再访问 raw CodeMirror。5.1–5.5 与全量门禁通过，生产模块 252→254，依赖/锁文件未变。