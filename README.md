# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 3.12 已完成 Platform 最终切换：ESM 调用者显式注入 Port，classic 兼容脚本经专用 compatibility host 调用 Platform；`src/runtime/tauri.js` 与 `window.markdownEditorNative` 已删除。当前 174 个生产模块 / 36 个 platform 模块。待 Windows Stage 3 最终回归；未改 Rust、依赖或锁文件。
