# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与阶段记录见 [docs/README.md](docs/README.md)。

2026-08-07：依赖读取外置到项目父目录：Node 使用 `../node_modules`，Vite 缓存位于其下，Cargo target 使用 `../.cargo-target/markdown-editor`，Windows 自动化宿主也位于父目录。依赖声明、锁文件及既有命令语义不变。Stage 0/1/2/3 已通过；Windows 父目录安装与两套二进制构建已通过，原生探测的重复 C# 编译超时已改为启动前一次编译、后续 DLL 复用，当前提交继续执行 Windows 实机回归。
