# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.7 PASS。Pointer Selection 拆为 caret/geometry reader、纯 selection policy、selection orchestrator；Extension Registry 继续唯一装配，旧单文件删除。生产模块 255→257，无依赖/锁文件变化；5.7 8/8、Node 44/44、Browser 10/10、Built App 21/21 PASS，DocumentModel 冻结。