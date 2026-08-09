# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.6 后续修复 PASS：锁文件安全升级 Mermaid、DOMPurify、PostCSS、nanoid，npm audit 4→0；Vite 拆分 CodeMirror/Lezer/KaTeX/D3 等 vendor，并以启动 500KB、异步 700KB 硬预算约束构建，原大 chunk warning 消除。5.1–5.6 与全量门禁通过，DocumentModel 保持冻结。