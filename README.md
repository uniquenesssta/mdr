# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-07：Atomic 3.7 已新增独立 FileSystem client，六个 Rust 文件命令从旧 runtime 直接映射中移出；路径、DroppedFile/图片 MIME、文件树与写入 DTO 语义保持不变，文档创建和 Toast 仍由业务层负责。当前提交待 Stage 3 与全量回归验证。
