# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-08：Atomic 3.11 已实现 capability-driven `createPlatform` 与独立 `desktop-platform` 组合，统一 12 个 Port；缺失能力显式抛出 `PLATFORM_CAPABILITY_UNAVAILABLE`，不以 no-op 伪装可用。当前 174 个生产模块 / 35 个 platform 模块；3.12 调用者切换及 `tauri.js` 删除尚未开始。待 Windows 实测验收；未改 Rust、依赖或锁文件。
