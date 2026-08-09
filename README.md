# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与历史记录见 [docs/README.md](docs/README.md)。

2026-08-09：Atomic 4.12 PASS：Settings Locale Controller 接管已提交语言设置，classic core/bootstrap 的 locale 权威退出，public/i18n.js 与全局 i18n/currentLang 均不存在。4.1–4.12、architecture、Node、Browser Contract、build、Built App 全通过；Stage 4 CI 已覆盖 4.12，依赖/锁文件未变，Stage 4 完成。
