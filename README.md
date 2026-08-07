# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-07：Atomic 3.10 已实现六个独立 Browser adapter：Storage、Download、Clipboard、Fullscreen、Print、FileReader。异常与 FileReader 取消显式化，资源清理职责独立；尚未执行 3.11 createPlatform 或业务调用切换。当前提交待 Windows 回归验证；未改 Rust、依赖或锁文件。
