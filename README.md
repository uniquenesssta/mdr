# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.6 后续修复 PASS：npm audit 保持 0，Vite 仅放行项目根与父级 `node_modules`，Windows/Tauri KaTeX 字体真实 dev 请求通过；Hybrid 块装饰改为合并 microtask 调度，表格交互竞态回归通过；性能采集不再读取 raw CodeMirror view。Stage 4、5.1–5.6、Architecture、Node 44/44、Browser 10/10、Build、Built App 21/21 全部通过，DocumentModel 保持冻结。