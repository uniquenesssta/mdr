# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.6 后续修复 PASS：npm audit 0；Vite 限定项目根与父级 `node_modules`，KaTeX 字体 dev 门禁通过；Hybrid 块装饰改为合并 microtask，表格竞态回归通过；性能采集移除 raw CodeMirror view。Stage 4、5.1–5.6、Architecture、Node 44/44、Browser 10/10、Build、Built App 21/21 PASS，DocumentModel 冻结。