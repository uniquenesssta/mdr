# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与阶段记录见 [docs/README.md](docs/README.md)。

2026-08-07：依赖读取外置到项目父目录：Node 使用 `../node_modules`，Vite 缓存位于其下，Cargo target 使用 `../.cargo-target/markdown-editor`，Windows 自动化宿主也位于父目录。依赖声明、锁文件及既有 npm/Tauri 命令语义不变。已验证父目录安装、路径契约和架构门禁；完整 CI 首轮仅因本 README 长度门禁失败。限制：父目录存在未知依赖或包清单时安装器会拒绝覆盖。
