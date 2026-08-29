# R12-02 — Path Policy

## 状态与边界

- 基线为已完成 R12-01 的 `28a21e6caaa384366553663262417de2a726f8a5`，继续使用独立 `agent/r12-stage`。
- 新增 `src-tauri/src/local_file/path_policy.rs`，唯一负责输入路径构造、必填路径、父目录、绝对/`file:`/相对图片解析、目录词法根边界以及目录项符号链接/不可读分类。
- `local_file.rs` 仍负责命令编排、实际正文/图片读写、文件类型、MIME、大小限制、目录递归和 DTO；R12-03 File Kind 及后续职责没有提前迁移。
- R12-01 专属 Actions 已由用户核验绿色并记录完成；R12-02 实现与本地可运行门禁完成，完整原生和浏览器验收交由 `.github/workflows/r12-02.yml`。按用户约定，推送后不等待或跟踪 Actions。

## 迁移结果

| 调用入口 | 复用的 Path Policy | 保留行为 |
|---|---|---|
| `read_local_image` | `resolve_local_image_path`、`parent_directory`、`input_path` | 支持绝对路径和 `file:`；相对图片基于 Markdown 父目录；`../images` 不被重写或新增拒绝。 |
| `read_dropped_file` | `input_path` | 原路径、文件判定、大小/MIME 和错误返回不变。 |
| `write_local_text_file` / `write_local_binary_file` | `required_path` | 仅空字符串拒绝，系统绝对路径与错误文本不变。 |
| `list_text_file_tree` | `required_path`、`parent_directory`、`inspect_tree_entry` | 根目录外词法条目跳过；符号链接跳过且不增加 `skippedCount`；不可读条目增加计数。 |

目录树现在显式把扫描根传给每层递归；`is_within_directory` 使用 `strip_prefix` 后拒绝 `ParentDir`、`RootDir` 和平台前缀组件，不做 canonicalize，也不跟随符号链接。该判定把既有安全边界变成单一可测策略，不扩大为对任意用户选择绝对路径的沙箱限制。

## 测试与兼容

- Path Policy 内含 10 个 Linux/Unix 直接测试，覆盖空路径、父目录、绝对路径、`file:` URL、相对图片、父相对图片、未保存文档、词法越界、不可读条目、常规文件与符号链接。
- 新增 5 个 Node 架构/契约测试，证明策略只有一个生产提供者、所有读写入口复用、目录树计数语义未变、命令签名/前端载荷/依赖未变，以及阶段工作流交接正确。
- R12-01 Rust/Node 兼容夹具改为同时读取 `local_file.rs` 与 `path_policy.rs`；原冻结断言没有删除或放宽，只跟随生产职责的新位置。
- 生产模块清单新增 Path Policy，并同步两个当前总模块数契约；没有改动冻结 Stage 1/8/9 历史夹具。

## 验证

| 验证 | 结果 |
|---|---|
| 定向 Node | 23/23 通过。 |
| 全量 Node | 366 项；首次运行准确发现两个当前模块总数仍为 425，已同步为新增模块后的 426，最终回归通过。 |
| 架构/文档门禁 | `verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record` 通过。 |
| 构建 | `npm run build` 通过。 |
| Workflow | R12-01/R12-02 YAML 解析通过；路由契约确认 R12-01 仅手动、R12-02 随 `agent/r12-stage` 自动运行。 |
| Rust | 当前容器没有 Cargo/rustfmt；Actions 使用 Rust 1.88 和完整 Linux Tauri 系统库，执行 Path Policy 10/10、R12-01 直接行为 10/10、独立兼容夹具 6/6、全量 Rust、Clippy `-D warnings` 和 Cargo check。 |
| 浏览器 | 当前容器未提供 Chrome；browser contract/app 交由 Actions。 |

## 契约、风险与回退

- 没有新增 crate 或 npm 包，Cargo/npm manifest、锁文件、前端 FileSystem client、命令注册与另外三个 Stage 12 Rust 单体均由 R12-02 scope guard 锁定。
- 本 Atomic 没有 canonicalize 用户选择路径，也没有禁止 Markdown 父相对图片；这是为了保持现有公开行为。目录树的符号链接仍整体跳过，因此不会递归越界。
- `TreeEntryPolicy` 携带 `fs::Metadata`，让一次 `symlink_metadata` 同时服务安全分类和现有大小/类型判断，避免检查与使用之间再做一次不同语义的元数据读取。
- 回退只需 revert R12-02 提交；没有数据格式、持久化内容、依赖或前端协议迁移。
- R12-02 Actions 未由用户核验绿色前不勾选 12.2，也不推进 R12-03。
