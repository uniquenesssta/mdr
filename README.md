# Markdown Editor

Markdown Editor 是一款基于 Tauri、Rust 与原生 Web 技术构建的轻量桌面 Markdown 编辑器，支持源码编写、实时预览、混合编辑、本地文档管理及多种导入导出能力。项目采用职责清晰的模块化架构，重视性能、可维护性与跨平台体验。完整架构说明、开发记录与验证结果见 [docs/README.md](docs/README.md)。

## Change Log

### 2026-08-07 — 依赖与重型构建缓存外置

- 新增 `npm run deps:prepare`，严格按当前 `package-lock.json` 将 Node 依赖准备到项目根目录上一级的 `../node_modules`；检测到根目录 `node_modules` 时直接拒绝继续，父目录存在未知依赖或已有包清单时也不会覆盖。
- Vite 缓存改为 `../node_modules/.vite/markdown-editor`；Cargo `target` 改为 `../.cargo-target/markdown-editor`，依赖缓存与 Rust 编译中间产物不再写入项目子目录。
- Stage 0/1/2/3 与 Windows 原生窗口自动化统一通过父目录依赖准备入口安装依赖；Windows 临时 Selenium WebDriver 依赖也通过同一入口安装到父目录。
- Windows 隔离 WebDriver 宿主改为 `../.markdown-editor-windows-driver-host`，其构建二进制统一从父目录 Cargo target 读取；生产 `Cargo.toml`、能力配置与 Tauri 配置的隔离语义保持不变。
- 既有依赖声明和 `package-lock.json` 未改变；`dev`、`build`、`preview`、Tauri、Node 测试及浏览器测试命令的既有调用语义保持不变，前提是先执行一次 `npm run deps:prepare`。
- 新增依赖位置契约测试，覆盖 Node、Vite、Cargo、CI 与 Windows 隔离宿主的父目录路径约束。提交前已完成新增 Node 脚本与测试文件的 `node --check` 语法验证；完整 Node、浏览器、Rust、Tauri 与 Windows 原生验证由本次提交触发的现有 GitHub Actions 执行，结果将在验证完成后补录。
