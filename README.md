# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整记录见 [docs/README.md](docs/README.md)，5.10 详见 [验收记录](docs/rewrite-progress/stage-05/05-10-editor-basic-commands.md)。

2026-08-10：CR-01～CR-05、Atomic 5.10 PASS。基础格式命令已收敛到 Editor Command Service，仅提交编辑事务；预览、保存和 Toast 继续由 UI wrapper 负责。Frozen DocumentModel、持久化、依赖和运行行为不变；5.11 未开始。