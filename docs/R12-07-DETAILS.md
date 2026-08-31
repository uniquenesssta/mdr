# R12-07 — Tree Limits

## 状态与边界

- 基线为已通过 R12-06 专属 Actions 的 `63582800b57a0ecf84c658fa25880896606d7ab2`，继续使用 `agent/r12-stage`。
- 新增 `src-tauri/src/local_file/tree_limits.rs`，唯一负责冻结的目录树深度、扫描条目和可读文本大小边界，以及每次扫描独立的计数与截断状态。
- `MAX_FILE_TREE_DEPTH` 仍为 24，`MAX_FILE_TREE_ENTRIES` 仍为 12,000；文件大小复用 Text Reader 的 `MAX_TEXT_BYTES`，不复制 20 MiB 数字来源。
- Directory Tree 继续唯一负责递归、排序、文件打开检查与 DTO 构造；Path Policy、File Kind 和 Text Reader 的职责不变。
- R12-08 Local Commands 未提前实施，六个 Tauri 命令仍在现有入口。

## 迁移结果

| 链路 | Tree Limits 用途 | 保留行为 |
|---|---|---|
| `list_text_file_tree` | 创建唯一默认 `TreeLimits` 并传入 Directory Tree | 命令名、参数、异步阻塞任务、性能日志和任务失败错误不变。 |
| 深度预算 | 深度小于或等于 24 时允许扫描，超过时标记截断 | 等于边界仍允许，超过边界才截断。 |
| 条目预算 | 每个读取到的目录条目在分类前占用一次 12,000 总预算 | 第 12,000 项允许，第 12,001 项标记截断。 |
| 文件大小 | 复用 Text Reader 的 20 MiB 上限 | 等于边界仍允许，大于边界计为 skipped。 |
| 调用状态 | 每次扫描独立持有 scanned/file/directory/skipped/truncated | 不增加全局、静态或跨调用状态。 |

旧 `local_file.rs` 已删除深度和条目常量；`directory_tree.rs` 已删除扫描状态结构与所有限制数字，只消费 Tree Limits 的公开内部接口。生产区仅保留一个深度常量提供者、一个条目常量提供者和一个 20 MiB 数字来源。

## 验证

| 验证 | 结果 |
|---|---|
| Tree Limits 直接 Rust | 6 项：默认边界、深度等值/越界、条目预算、大小等值/越界、计数、调用状态隔离；由 R12-07 Actions 使用 Rust 1.88 执行。 |
| Directory Tree 回归 | 既有 6 项由 Actions 复验，确保递归、排序、跳过、计数、截断与符号链接策略不变。 |
| 定向 Node | R12-01 至 R12-07、FileSystem adapter 和 workflow 路由 50/50 通过。 |
| 全量 Node | 393/393 通过。 |
| 架构门禁 | `verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record` 通过；新增 Tree Limits 权威，生产模块清单由 432 增至 433。 |
| 构建与依赖 | `npm run build` 通过；`npm audit --audit-level=high` 为 0 个漏洞。 |
| 浏览器 | 当前容器没有 Chromium/Chrome，browser contract/app 交由 R12-07 Actions。 |
| Rust | 当前容器没有 Cargo/rustfmt；Actions 执行 Tree Limits 6/6、全部既有分层 Rust、全量 Rust、Clippy `-D warnings` 和 Cargo check。 |

R12-07 Actions 未由用户核验绿色前不勾选 12.7，也不推进 R12-08。

## 契约、风险与回退

- 没有新增 crate 或 npm 包，Cargo/npm manifest 与锁文件未修改；其他 Stage 12 Rust 单体、前端 FileSystem client 和命令注册受 scope guard 保护。
- 六个本地文件命令、参数、Serde DTO 字段、错误文本、路径/类型规则、深度 24、条目 12,000 与文本大小边界未改变。
- 目录预算仍统计分类前的全部条目，空目录仍不计入目录数，符号链接仍直接跳过且不增加 skipped count。
- 回退只需 revert R12-07 提交；没有数据格式、持久化内容、依赖或前端协议迁移。
