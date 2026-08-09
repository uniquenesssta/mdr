# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.7 Pointer Selection PASS。原精确指针单文件拆为 caret/geometry reader、纯 selection policy、selection orchestrator 三个职责模块；Extension Registry 仍为唯一装配入口，旧实现已删除。模块 255→257，无依赖/锁文件变化；5.7 8/8、Node 44/44、Browser 10/10、Build、Built App 21/21 全部通过，DocumentModel 保持冻结。