# 阶段 0 / 节点 00-02：初始基线验证

## 节点状态

- 结果：**失败，发现必须先处理的基线阻塞**
- 后续阶段：**当时禁止进入阶段 1**
- 工作流：`Stage 0 Baseline Verification`
- Actions run：`30883814364`，attempt `1`
- 证据工件：`stage-00-baseline-30883814364-1`
- 工作分支：`rewrite/modular-rebuild`
- 验证提交：`28c70e51b4119b1161e35668994e5f504ff4a630`
- 原始业务源码基线：`main@8ec8bf4ed58e6fd1c5c91466569a56ba247b6a62`

## 已完成的基线采集

- 固定仓库基线、工作分支和验证提交。
- 采集源码清单、Tauri command、storage key、生成产物和大型文件信号。
- 固定 9 个禁止修改算法或数据契约文件的 SHA-256。
- 建立 GitHub Actions、命令记录器、结构化验证摘要和证据工件上传。

## 初始验证结果

通过：

- Tauri Linux 系统依赖安装；
- `npm ci`；
- Node 测试；
- 浏览器交互契约；
- Vite 生产构建；
- 静态契约与冻结模型采集。

失败：

- 应用级浏览器回归共 7 项，仅 2 项通过、5 项失败；
- 项目声明 Rust 1.77.2，但锁定依赖使用 Edition 2024 manifest 和更高版本稳定能力，`cargo test --locked`、`cargo check --locked` 与 Tauri build 无法通过。

## 影响范围

本节点只建立基线和复现证据，没有修改业务源码、冻结模型、公共接口、持久化格式或用户可观察行为。

## 阶段结论

初始基线不满足阶段 0 退出条件。浏览器交互链和 Rust 工具链兼容性必须修复并完成全量回归后，才能结束阶段 0。修复过程和最终验证记录见 `00-03-baseline-blocker-repair.md`。
