# 当前验证范围：仅 Windows

生效日期：2026-09-29。依据：用户明确要求“取消 Linux 和 mac 的验证，只针对 Windows 端”。本文件是本仓库任务书的当前平台范围覆盖规则，适用于全部阶段及后续任务。

- 产品验收、CI、构建、原生窗口与系统交互验证只要求 Windows。Linux/macOS 不再是交付条件，不再调度对应 runner；不把此前这些平台通过的结果算作新的 Windows 证据。
- `.github/workflows/r12-14.yml` 是当前阶段的自动入口，全部活动 job 运行于 Windows；前端、Rust、原生链接和递归全仓 Node 测试分别记录结果。完整 Node 入口为 `node scripts/ci/run-repository-tests.mjs`，按 Git 跟踪清单枚举所有 `tests/**/*.test.mjs`，各目录失败后继续收集，其最终退出码仍失败。
- `stage-03-windows-window.yml` 保留为手动 Windows 原生窗口验收。其余 43 个旧工作流保留历史定义，但每个 job 明确禁用；即使 dispatch 或旧分支 push 触发，也不调度 Linux/macOS 工作负载。
- 当前流程移除了 Linux 系统库安装、xdg-open 真实进程验证、Linux schema 归档和 macOS matrix。Unix 条件测试在 Windows 不编译，三个阶段数量断言按实际 Windows 测试调整：Directory Tree 5、Path Policy 9、stage_12_ 9。不能声称未运行的 Unix 测试通过。
- 原生 opener 的函数签名/链接检查仅证明编译链接，不证明 ShellExecute 实际行为。Windows 安装、启动、文件关联、保存、关闭恢复和真实打开外链仍需各自的真实验收证据。
- 平台生产代码、历史测试文件与历史日志保留。针对历史文件内容的静态检查不等于要求再次验收该平台。
- 当前环境中的文档、脚本、配置静态检查仅用于审计和变更自检，不作为 Linux 产品验证，也不能替代 Windows CI。

本次不放宽模型算法、持久化格式、版本一致性、数据恢复、权限边界、测试失败退出或 Clippy 警告门禁。其他任务书约束的评估与建议见 `FULL_CODE_AUDIT.md`，建议不等于已自动取消全部约束。验收状态仍未通过。
