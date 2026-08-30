# R12-05 — Text/Binary Writers

## 状态与边界

- 基线为已通过 R12-04 专属 Actions 的 `d92f8393b197544f3332da1e8324003e62d35ceb`，继续使用 `agent/r12-stage`。
- 新增 `src-tauri/src/local_file/text_writer.rs`，唯一负责将 UTF-8 文本字节写入已解析路径，并返回实际 UTF-8 字节数。
- 新增 `src-tauri/src/local_file/binary_writer.rs`，唯一负责 Base64 解码与二进制字节写入。
- Writer 不解析路径、不创建父目录、不处理 dialog、不暴露 Tauri command，也不构造 `LocalWriteResult` DTO。
- R12-06 Directory Tree 及后续职责没有提前迁移。

## 迁移结果

| 调用入口 | Writer 用途 | 保留行为 |
|---|---|---|
| `write_text_file` | 路径解析后委托 `text_writer::write_text` | 使用 UTF-8 字节覆盖写入；空内容返回 0；`无法写入文本文件：` 错误前缀不变。 |
| `write_binary_file` | 先由 `binary_writer::decode_binary` 解码，再委托 `write_binary` | 解码先于计时与写入；字节数、覆盖写入、`文件数据解码失败：` 与 `无法写入文件：` 错误前缀不变。 |

旧 `local_file.rs` 的生产区已删除 `fs::write`、Base64 import 和直接 decode，不保留第二份写入权威。路径空值校验、计时日志和 DTO 构造仍由原命令编排层负责；两个 Writer 都不会自动创建父目录。

## 验证

| 验证 | 结果 |
|---|---|
| Writer 直接 Rust | 10 项：文本 4 项、二进制 6 项；由 R12-05 Actions 使用 Rust 1.88 执行。 |
| 定向 Node | R12-01 至 R12-05、FileSystem adapter 和 workflow 路由共 38/38 通过。 |
| 全量 Node | 381/381 通过。 |
| 架构门禁 | `verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record` 通过；生产模块清单由 429 增至 431。 |
| 构建与依赖 | `npm run build` 通过；`npm audit --audit-level=high` 为 0 个漏洞。 |
| 浏览器 | 当前容器没有 Chromium/Chrome，browser contract/app 交由 R12-05 Actions。 |
| Rust | 当前容器没有 Cargo/rustfmt；Actions 执行 Writer 10/10、Reader 10/10、File Kind 6/6、Path Policy 10/10、R12-01 行为 10/10、独立兼容夹具 6/6、全量 Rust、Clippy `-D warnings` 和 Cargo check。 |

## 契约、风险与回退

- 没有新增 crate 或 npm 包，Cargo/npm manifest 与锁文件未修改；`main.rs`、三个其他 Stage 12 Rust 单体、Path Policy、File Kind、两个 Reader 和前端 FileSystem client 受 scope guard 保护。
- 六个本地文件命令名、参数、Serde DTO、错误文本、路径解析、文件分类、覆盖写入和性能日志字段未改变。
- 文本字节数继续使用 UTF-8 `str::len()`；二进制字节数继续在 Base64 解码后计算。Writer 不创建父目录，也不拥有文件选择对话框。
- 回退只需 revert R12-05 提交；没有数据格式、持久化内容、依赖或前端协议迁移。
- R12-05 Actions 未由用户核验绿色前不勾选 12.5，也不推进 R12-06。
