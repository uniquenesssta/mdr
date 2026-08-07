# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-07：Atomic 3.8 已新增独立 DocumentStore client，十个 Rust 存储命令及分块参数从旧 runtime 直接映射中移出，camelCase/版本/DTO 语义不变；E2E 浏览器探测改为无启动式 PATH/文件检查，实际回归仍使用 headless，避免 Windows 探测弹窗。当前提交待验证；未修改 Rust、业务会话或锁文件。
