# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Stage 5 / Atomic 5.4 PASS：RecentFilesRepository 接管最近文件上限、大小写无关路径去重、序列化修复与清空；classic `core.js` 仅保留菜单渲染/Toast/菜单关闭等 UI 壳，Repository 不依赖菜单 DOM。5.1–5.4、冻结 DocumentModel、Architecture、Node、Browser Contract、Build、Built App 全通过；生产模块 250→252，依赖/锁文件未变；正式 Stage 5 CI run `31312167268` SUCCESS。