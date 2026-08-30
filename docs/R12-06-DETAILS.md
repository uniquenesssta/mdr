# R12-06 — Directory Tree

## 状态与边界

- 基线为已通过 R12-05 专属 Actions 的 `50a827359705577bc978cf5e421bcb2930a44f13`，继续使用 `agent/r12-stage`。
- 新增 `src-tauri/src/local_file/directory_tree.rs`，唯一负责目录树 DTO、递归扫描、目录优先稳定排序、空目录省略、跳过/计数和截断报告。
- Path Policy 继续唯一负责目录边界、符号链接与不可读元数据分类；Directory Tree 消费分类结果，不重复执行 `symlink_metadata`。
- R12-07 Tree Limits 未提前迁移：`MAX_FILE_TREE_DEPTH` 与 `MAX_FILE_TREE_ENTRIES` 仍在原入口，由调用方传入扫描器。
- Directory Tree 不暴露 Tauri command，不写文件、不处理 dialog、不记录性能日志，也不拥有跨调用状态。

## 迁移结果

| 链路 | Directory Tree 用途 | 保留行为 |
|---|---|---|
| `list_text_file_tree` | 将文档路径与现有两个限制传入 `build_text_file_tree` | 命令名、参数、异步阻塞任务、性能日志和任务失败错误不变。 |
| 根目录验证 | 验证当前文档、支持类型和父目录可读性 | 五类既有错误文本与校验顺序不变。 |
| 递归扫描 | 扫描支持且可读的 Markdown/TXT，省略空目录 | 文件/目录计数、超大或不可读文件 skipped count、深度/条目截断不变。 |
| 排序 | 每级目录优先，再按 ASCII 小写名称和原名称稳定排序 | 既有树形 DTO、路径和名称不变。 |
| 符号链接 | 对 Path Policy 的 `Skip` 直接继续 | 文件链接和目录链接均不跟随，也不增加 skipped count。 |

旧 `local_file.rs` 的生产区已删除扫描状态、递归、排序、`fs::read_dir` 与树内 `File::open`，不保留第二份目录树权威。`TextFileTree` 与 `TextFileTreeNode` 从新模块公开重导出，Serde `camelCase` 字段契约不变。

## 验证

| 验证 | 结果 |
|---|---|
| Directory Tree 直接 Rust | 6 项：嵌套树/空目录、稳定排序、文档错误、深度与条目截断、超大文件跳过、文件与目录符号链接；由 R12-06 Actions 使用 Rust 1.88 执行。 |
| 定向 Node | R12-01 至 R12-06、FileSystem adapter 和 workflow 路由共 44/44 通过。 |
| 全量 Node | 387/387 通过。 |
| 架构门禁 | `verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record` 通过；生产模块清单由 431 增至 432。 |
| 构建与依赖 | `npm run build` 通过；`npm audit --audit-level=high` 为 0 个漏洞。 |
| 浏览器 | 当前容器没有 Chromium/Chrome，browser contract/app 交由 R12-06 Actions。 |
| Rust | 当前容器没有 Cargo/rustfmt；Actions 执行 Directory Tree 6/6、Writer 10/10、Reader 10/10、File Kind 6/6、Path Policy 10/10、R12-01 行为 10/10、独立兼容夹具 6/6、全量 Rust、Clippy `-D warnings` 和 Cargo check。 |

## 契约、风险与回退

- 没有新增 crate 或 npm 包，Cargo/npm manifest 与锁文件未修改；`main.rs`、三个其他 Stage 12 Rust 单体、Path Policy、File Kind、Readers、Writers 和前端 FileSystem client 受 scope guard 保护。
- 六个本地文件命令、参数、Serde DTO 字段、错误文本、路径/类型规则、深度 24、条目 12,000 和文本大小边界未改变。
- 目录树仍只按扩展名、元数据大小和打开可读性筛选，不增加 magic-byte 读取；符号链接在递归前由 `symlink_metadata` 分类为 `Skip`。
- 回退只需 revert R12-06 提交；没有数据格式、持久化内容、依赖或前端协议迁移。
- R12-06 Actions 未由用户核验绿色前不勾选 12.6，也不推进 R12-07。
