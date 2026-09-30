# Markdown Editor

Stage 12：`agent/r12-stage`；历史见 [docs/README.md](docs/README.md)。

## Change Log

- 2026-09-30：R12-21 修正新增模块后的清单断言及只读测试原属性恢复，保留全部门禁；首次 Windows 写入专项 18/18、Rust 268/268，修正提交待 CI 复验。[详情](docs/R12-21-DETAILS.md)。
- 2026-09-30：R12-21 文本/二进制共用同目录临时文件、同步与 Windows 安全替换；新增 18 项故障回归，保留原命令及字节契约；Windows 动态验收待 CI。[详情](docs/R12-21-DETAILS.md)。
- 2026-09-18：R12-08 已验收，09～13 已完成；[详情](docs/R12-08-DETAILS.md)。
- 2026-09-29：R12-14/A01、16 已专项验收；[详情](docs/R12-16-DETAILS.md)。
- 2026-09-30：R12-17 命令迁移，19 项注册不变；Windows 专项通过，40 项遗留不变。[详情](docs/R12-17-DETAILS.md)。
- 2026-09-29：R12-18 修正审计门禁并补齐清单，Windows 审计专项已验收；真实 Preview 循环依赖仍保留失败。[详情](docs/R12-18-DETAILS.md)。
- 2026-09-30：R12-19 修复保存失败传播、dirty 提交边界及 Rust 缓存失效；Windows 专项已验收，Rust 250/250；唯一既有 Preview 循环依赖仍待 R12-22。[详情](docs/R12-19-DETAILS.md)。
- 2026-09-30：R12-20 复核现行脱敏链路，补充错误原因链、异常属性及数组 JSONL 回读断言；Windows 专项已验收；唯一既有 Preview 循环依赖仍归 R12-22。[详情](docs/R12-20-DETAILS.md)。
