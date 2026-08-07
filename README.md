# Markdown Editor

Tauri + Rust 桌面 Markdown 编辑器。完整架构与记录见 [docs/README.md](docs/README.md)。

2026-08-07：Atomic 3.8 PASS：DocumentStore client 接管 10 个 Rust 存储命令，camelCase/版本/DTO 不变；E2E 浏览器探测改为纯 PATH/文件检查，实际回归保持 headless。Windows 验证：架构门禁、Node 42/42、浏览器 10/10+12/12、build、evidence 均通过，npm audit 0；专项唯一失败为注释触发的正则误报，已用无行为改动修正并复核原失败断言。未改 Rust、业务会话或锁文件。
