# 阶段 0 / 节点 00-01：治理规则与 GitHub Actions 基线验证引导

## 节点目标

在不修改业务源码和运行行为的前提下，为阶段 0 建立仓库内可读取的治理规则、可复现的基线采集工具和 GitHub Actions 执行入口。

## 实际基线

- 仓库：`uniquenesssta/mdr`
- 原始基线分支：`main`
- 原始基线提交：`8ec8bf4ed58e6fd1c5c91466569a56ba247b6a62`
- 工作分支：`rewrite/modular-rebuild`
- 任务书中记录的 `uniquenesssta/markdown@0c3ebed...` 仅作为任务书来源信息；本轮及后续实施均以本节记录的 `mdr` 基线为准。

## 完成内容

### 1. 治理规则入库

新增根目录文件：

- `ALL_AI_CODE.md`
- `AI_PROJECT_RULES.md`

内容来自本项目已提供的权威规则附件，未自行缩写、补充或改写。后续 GitHub Actions、阶段任务和人工审查均可从仓库根目录直接读取。

对应提交：

- `984179b181452d02d5d8e9d9dc176b4d79f9d4cf`
- `5c84ced95469efca5792c7ffedd8356b15c0da4b`

### 2. 阶段 0 命令记录器

新增：`scripts/stage-00/run-check.mjs`

职责：

- 以无 shell 拼接方式执行单个验证命令；
- 同步输出 stdout/stderr；
- 记录开始时间、结束时间、持续时间、退出码、信号和启动错误；
- 为每个检查生成独立 JSON 和日志文件；
- 保持被执行命令的真实退出码。

对应提交：`c0fb3d73e14e75f587460e5caf25b74ab3cbd284`

### 3. 静态基线与契约采集器

新增：`scripts/stage-00/collect-baseline.mjs`

采集范围：

- 当前分支、HEAD、工作区状态、diff、未跟踪文件；
- runner、Git、Node、npm、Rust、Cargo、Chrome 环境；
- 全部跟踪文件、文件大小、行数和 SHA-256；
- 冻结模型清单及 SHA-256；
- Tauri 命令注解与 `generate_handler!` 注册项；
- storage key、快捷键位置、阈值和限制位置；
- `window.markdownEditor*` 全局接口位置；
- 经典脚本加载器、HTML 内联事件、导出入口；
- 文档存储结构符号；
- 被错误跟踪的构建缓存、运行日志或生成目录；
- 当前最大源码文件清单。

采集器只读取仓库内容并生成 Actions 工件，不修改生产源码、数据或配置。

对应提交：`3f5441870c0b7b8231cf7716bf3993b9c21ed1f7`

### 4. 验证结果汇总器

新增：`scripts/stage-00/summarize-results.mjs`

硬性检查：

- `npm ci`
- `npm test`
- `npm run test:browser:contract`
- `npm run build`
- `npm run test:browser`
- `cargo test --locked`
- `cargo check --locked`

扩展检查：

- `npm run tauri:build -- --verbose`

汇总器会生成 JSON 与 Markdown 结果，并在启用 `--enforce` 时根据硬性检查真实退出状态决定阶段门禁。

对应提交：`0f23604538799a51345322812d2746fa90520949`

## 行为与兼容性影响

- 未修改 `src/`、`public/`、`index.html`、`src-tauri/src/` 或现有测试。
- 未改变公共接口、持久化格式、Tauri 命令、快捷键、默认值或用户可观察行为。
- 未新增生产依赖或开发依赖。
- 仅新增治理文档和阶段 0 验证工具。

## 已完成验证

- 两份规则文件已成功写入 `rewrite/modular-rebuild`。
- 三个阶段 0 Node 工具已成功写入工作分支。
- 文件写入由 GitHub Contents API 返回成功提交 SHA。

## 尚未完成的验证

本节点仅完成 Actions 引导准备，以下验证将在节点 00-02 的 GitHub Actions 运行中执行并记录：

- Node 单元与契约测试；
- 前端构建；
- Chromium 浏览器回归；
- Rust 测试与检查；
- Tauri Linux 构建；
- 静态契约与冻结模型工件生成。

## 剩余风险

- GitHub Actions 是否在该仓库启用，需要通过工作流提交后的真实运行确认。
- Linux runner 与原 Windows/Tauri 使用环境存在平台差异；Linux 结果用于验证跨平台源码和构建链，不能替代最终 Windows 原生窗口行为验证。
- Tauri 打包可能受 runner 系统库、AppImage 工具链或平台打包条件阻塞；若发生，将保留完整日志并区分代码失败与环境失败。
