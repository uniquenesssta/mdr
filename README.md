# Markdown Editor

模块化 Markdown 编辑器；Stage 11 已推进到 R11-01：已冻结当前 Rust 文档存储二进制兼容夹具，覆盖 A/B 快照、meta、journal、截断日志、损坏槽及中文/Emoji/UTF-16。生产存储实现、命令、DTO 与磁盘格式未改。R11-01 工作流已补齐任务书要求的全量 `cargo clippy --all-targets -- --deny warnings` 硬门禁；该门禁及完整回归全部通过前不收口、不进入 R11-02。项目记录见 [docs/README.md](docs/README.md)，本任务验证见 [docs/R11-01-DETAILS.md](docs/R11-01-DETAILS.md)。
