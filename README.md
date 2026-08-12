# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。Atomic 6.14 已完成 Stage 6 销毁验证：Layout/Sidebar/Menu/Window 的 listener、pointer capture、observer、RAF、timer、subscription 在 destroy 后归零；并修复 Compact Split stale ResizeObserver 在销毁后重新申请 RAF。candidate `31606853046` 全链 PASS；Stage 7 未开始。Frozen Model、持久化、Rust、依赖未改。详见 [docs/README.md](docs/README.md)。
