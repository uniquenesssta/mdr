# Markdown Editor

模块化 Markdown 编辑器。Stage 11 R11-02 已完成 Serde DTO 向 `document_store/types.rs` 的职责迁移，JSON/Tauri/磁盘/恢复/UTF-16/依赖契约保持不变。R11-02 CI 现按触发事件检出实际源码 HEAD（PR 使用 head SHA，其余使用 `github.sha`），并仅额外接纳本阶段已授权的根 `AGENTS.md`；固定基线和全部硬门禁未放宽。当前最终 HEAD 正在重跑完整 Rust/Clippy/Node/Browser/Build 验证，通过前不收口、不进入 R11-03。详情见 [R11-02](docs/R11-02-DETAILS.md)。
