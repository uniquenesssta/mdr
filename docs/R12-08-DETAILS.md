# R12-08 — Local Commands

### 联合验收闭环（2026-09-16）

提交 `5a296257535ebf2222f8b0345ffda89f9a346310` 的 [联合 Actions #34996236589](https://github.com/uniquenesssta/mdr/actions/runs/34996236589) 两个 job 与全部硬性步骤成功：真实命令 12/12、Tree Limits 6/6、全部 Rust 回归、Clippy `-D warnings`、Cargo check、前端/浏览器/构建、审计以及最终工作区检查均通过。此前失败唯一未跟踪项为 `src-tauri/gen/schemas/linux-schema.json`；现在仅在确认构建前不存在、未被跟踪且与 desktop schema 字节一致后归档到 runner 证据目录，未知文件和源码修改仍会失败。新增 7 项真实临时工作区测试保护此边界。07/08 已完成，允许进入 R12-09；用户已确认桌面端可通过 `npm run tauri:dev` 打开，这不替代自动验收。

## 状态与输入

- 分支继续使用 `agent/r12-stage`；生产源码基线为 R12-07 的 `9405ab44d6bb5f05eb755a2341e3ba76b4831ed8`。
- 远端准备提交截至 `0fad7178bfa83496a4774ee3ce46316c3904ea6b`，只改变临时源码/格式工具准备、历史工作流触发方式与 README，没有改变生产源码或依赖。取得的固定源码快照工作区干净；本轮未接触用户电脑上的未提交修改。
- 用户要求 R12-07 复验与 R12-08 一起执行。历史 R12-07 Actions `33468075423` 已成功，但不作为本轮联合验收结果。
- 本轮实施范围仅 R12-08；12.7/12.8 的联合硬性验收未确认前不新增完成勾选，不进入 R12-09。

## 结果与职责

| 责任 | 权威位置 | 边界 |
|---|---|---|
| 目录入口 | `src-tauri/src/local_file/mod.rs` | 模块声明、命令边界与历史 DTO 导出，不承载业务实现。 |
| Tauri 命令 | `local_file/commands.rs` | 六个命令的参数接收、同步/阻塞调度、结果/任务错误映射及原有性能日志。 |
| 操作编排 | `local_file/operations.rs` | 组合既有路径、类型、元数据和 Readers/Writers，构造读写结果，选择启动参数中的第一个可用文本路径；不复制底层 I/O 或策略。 |
| 返回类型 | `local_file/types.rs` | 原 `DroppedFile`、`LocalImageData`、`LocalWriteResult` 与 camelCase/nullable/字节计数契约。 |
| 安全与内容能力 | 既有八个底层模块 | Path Policy、File Kind、Readers、Writers、Directory Tree、Tree Limits 的源 Blob 全部保持不变。 |

旧 `src-tauri/src/local_file.rs` 删除，没有兼容单体或第二份实现。`main.rs` 仅把六个 `local_file::命令` 注册路径改为 `local_file::commands::命令`；没有提前重构 R12-17 的全局注册职责，前端调用名、参数及客户端源文件未改变。

Tauri 2 模块化命令注册方式经 Context7 和官方文档核对，实际锁定 Tauri 2.11.5、tauri-macros 2.6.3；最终宏展开/类型检查仍由完整 Cargo 门禁确认。没有新增 crate、npm 包或生产配置。

## 兼容性与测试迁移

原本地文件 4 项回归与 R12-01 的 4 项直接安全行为测试移到 `src-tauri/tests/local_file/`，通过目录入口的 `cfg(test)` 引入，保留原 `local_file::tests` / `local_file::stage_12_tests` 测试路径和全部断言。独立兼容夹具改为读取真实 `mod.rs`；旧源溯源 manifest 不变。

新增 12 项真实命令测试，直接调用 Tauri 命令函数、真实异步运行时与真实临时文件，覆盖文本/图片读取、中文及 Emoji、MIME/Data URL、DTO 字段、写入覆盖、Base64 解码优先级、错误传播、缺失父目录不创建、目录截断及第二次调用隔离、启动文件选择。未用 Mock 替代文件 I/O 或命令执行。

Node 契约现在按真实责任模块读取源码，而非要求代码仍位于已删除的单体。新增与固定基线逐函数比较，保护命令签名、调度、计时字段、错误文本、操作体、DTO、全部旧 Rust 测试及八个底层 Blob。生产模块清单从 433 增至 436；所有新增项具有唯一责任记录。

根 README 保持原有 120–360 字符门禁，并提供规则要求的当前 Change Log；原来禁止根目录 Change Log 的旧布局断言改为要求有效日期、R12-08 记录和详细文档引用，未取消简短性约束。历史记录留在 `docs/README.md`。

## 验证证据

| 验证 | 本轮结果 |
|---|---|
| R12-01–08 定向 Node 与工作流路由 | 49/49 通过；不包含因依赖未安装而无法加载的前端 FileSystem adapter 测试。 |
| 原 FileSystem adapter 测试 | 本容器缺 `@tauri-apps/plugin-dialog`，加载失败；联合 Actions 原样运行。 |
| Rust 1.88 格式检查 | 所有本地文件模块、迁移测试、新命令测试与独立兼容夹具通过；不等同于 Rust 编译/运行测试。 |
| 全量 Node 与架构门禁 | 全量 Node 实际 371/378，剩余 7 项因锁定依赖缺失而失败；架构导入检查同样缺少 CodeMirror、marked、katex、Vite 和 Tauri 前端包，不能声明通过。联合 Actions 安装锁定依赖后完整复验。 |
| Rust 测试、Clippy、Cargo check | 本容器无 Cargo；专属 Actions 固定 Rust 1.88，执行新增 12 项、旧回归与所有原严格门禁。 |
| 构建、浏览器、安全审计 | 本地未完成；由联合 Actions 执行，未跳过或降级。 |
| 独立门禁 | `verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record` 通过；文档布局测试另有 1/1 通过。 |
| 变更差异 | `git diff --check` 与定向基线内容比较通过；未修改前端源码、其他 Rust 功能或依赖锁文件。 |

## 联合 Actions

`.github/workflows/r12-08.yml` 是 Stage 12 唯一自动验收入口，检出事件精确提交。包含命令测试 12/12、旧本地文件 4/4、Tree Limits 6/6、Directory Tree 6/6、Writers 10/10、Readers 10/10、File Kind 6/6、Path Policy 10/10、旧行为 10/10、独立兼容夹具 6/6、全量 Rust、Clippy `-D warnings`、Cargo check、Node、架构、构建、浏览器与依赖审计。

原 R12-07 工作流保留所有历史步骤并仅手动触发；它针对旧目录布局，只应用于其历史提交，不应在迁移后的 HEAD 代替联合验收。测试日志通过既有 `MARKDOWN_EDITOR_LOG_DIR` 指向 runner 临时目录，避免真实命令测试污染仓库。证据始终上传，不能把未运行的步骤算作通过。

### 首次联合流程配置修正

实现提交 `4c8f2264f3ed8c196819d0028d6917ff898504ca` 已更新到原分支。此前候选组装流程在同一文件树上执行 50 项源码契约，50/50 通过；其后 Git tree 发布因临时任务令牌权限不足失败，已改由 GitHub 连接器完成相同树哈希的提交，未变更候选代码。

首次联合运行 `34989241467` 在创建测试任务前即失败：Rust job 的 `env` 使用了该位置不支持的 `${{ runner.temp }}`。现改为在已有“Record validation target”步骤通过 `$RUNNER_TEMP` 与 `$GITHUB_ENV` 初始化 `MARKDOWN_EDITOR_LOG_DIR`，仍使用 runner 临时目录，不改变任何生产逻辑或验收步骤。现有工作流契约测试增加禁止 job 级 `runner` 上下文及检查正确初始化的断言；本地包括文档检查在内的 50 项契约重新通过。完整 Rust、前端与浏览器结果以修正后的联合运行记录为准，不能把此次配置修复视为联合验收通过。

## 清理与回退

- 临时源码/格式工具准备工作流随实现移除；工具归档、日志和下载包不进入生产仓库。
- 单一实现提交完整包含入口切换、删除、测试、所有权清单、工作流与文档。回退只针对该实现提交，不回退 R12-07 或准备提交之外的用户改动。
- 没有持久化格式或用户数据迁移；剩余风险是联合 Actions 尚未确认的实际编译、平台运行和浏览器回归。

## 架构图

已使用 Mermaid Chart 核对当前代码链路：前端 → 六个命令及调度/计时 → 操作编排或目录扫描 → 各底层策略与 I/O → 稳定 DTO/错误。图中无新增运行时状态或未实施的后续阶段能力。
