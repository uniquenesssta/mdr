# Stage 3 Atomic Task 3.5 — Windows Automated 补充验证

## 目标

在不修改生产权限、Tauri 配置、Rust 命令、公共窗口接口或文档保存策略的前提下，为 Atomic Task 3.5 增加真实 Windows WebView2 自动化门禁，并迁移根目录 README。

## 实现

- 新增独立 Windows 工作流 `.github/workflows/stage-03-windows-window.yml`，使用 `windows-2025`、固定 `webdriverio@9.30.0` 与 `tauri-driver 2.0.6`。
- 新增 `tests/e2e/windows/`，按 WebDriver 会话、Win32 窗口状态、证据记录三个职责拆分。
- 自动验证最大化/还原、最小化/恢复、resize 订阅与幂等 disposer、真实标题栏拖动、close-request 阻止与保存边界、正常关闭和强制关闭。
- WebDriver 依赖只在 CI 中以 `--no-save --no-package-lock` 临时安装；未新增生产依赖，未修改 `package.json`、`package-lock.json`、Cargo 依赖、权限或 `withGlobalTauri`。
- 原根目录 `README.md` 的完整内容迁移到 `docs/README.md`；根 README 改为简短项目介绍。架构记录与 Stage 0 持久化入口同步改为 `docs/README.md`。
- 新增静态契约测试，锁定文档布局、依赖隔离、固定工具版本和 Windows 覆盖范围。

## 验证

最终 GitHub Actions run、证据 artifact、仍受环境限制的路径将在门禁完成后记录于本节和 `docs/README.md`。
