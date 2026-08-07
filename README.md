# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-07：依赖读取已外置到项目父目录：Node 使用 `../node_modules`，Vite 缓存位于其下，Cargo target 使用 `../.cargo-target/markdown-editor`，Windows 自动化宿主也位于父目录。依赖声明、锁文件及既有命令语义不变。Stage 0/1/2/3 与 Windows 原生窗口回归均通过；Windows C# 探针改为启动前一次编译、后续 DLL 复用。限制：历史 `.vite/deps` 仅作 Stage 迁移基线保留，不参与运行时依赖读取。
