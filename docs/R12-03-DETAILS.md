# R12-03 — File Kind

## 状态与边界

- 基线为已通过 R12-02 专属 Actions 的 `7df7b59cfc547161bb171e1052bc9991bb8d954c`，继续使用 `agent/r12-stage`。
- 新增 `src-tauri/src/local_file/file_kind.rs`，唯一负责最终扩展名规范化、文本/图片/不支持分类，以及受支持图片 MIME 映射。
- File Kind 是无状态纯函数边界，不读取文件或 metadata，不持有路径、大小限制、Base64、命令、DTO、目录树或实际 I/O。
- R12-04 Text/Image Readers 及后续职责没有提前迁移。

## 迁移结果

| 调用入口 | File Kind 用途 | 保留行为 |
|---|---|---|
| `read_dropped_file` | 一次分类为 `Text`、`Image { mime }` 或 `Unsupported` | 文本/图片大小限制、读取顺序、Data URL、错误文本和 DTO 不变。 |
| `read_local_image` | 只接受带冻结 MIME 的 `Image` | 20MB 限制、路径解析、读取与 Base64 编码不变。 |
| `list_text_file_tree` / `initial_file_path` | 复用文本路径判定 | `md`、`markdown`、`txt` 大小写不敏感；树限制与不可读策略不变。 |
| 三个写入/列表命令日志 | 复用规范化扩展名 | 性能日志字段和值语义不变。 |

旧 `local_file.rs` 已删除 `extension`、`image_mime` 和文本/图片扩展分支，不保留第二份类型权威。扩展名仍只读取最终 path extension，无法转为 UTF-8 或无扩展名时仍为空字符串；图片 MIME 继续固定为 PNG、JPEG、GIF、WebP 和 SVG。

## 验证

| 验证 | 结果 |
|---|---|
| 定向 Node | R12-01/R12-02/R12-03、FileSystem adapter 和 workflow 路由共 28/28 通过。 |
| 全量 Node | 371/371 通过。 |
| 架构门禁 | `verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files` 通过；生产模块清单由 426 增至 427。 |
| 构建 | `npm run build` 通过。 |
| 浏览器 | 当前容器没有 Chromium/Chrome，browser contract/app 交由 R12-03 Actions。 |
| Rust | 当前容器没有 Cargo/rustfmt；Actions 使用 Rust 1.88，执行 File Kind 6/6、Path Policy 10/10、R12-01 行为 10/10、独立兼容夹具 6/6、全量 Rust、Clippy `-D warnings` 和 Cargo check。 |

## 契约、风险与回退

- 没有新增 crate 或 npm 包，Cargo/npm manifest 与锁文件未修改；`main.rs`、Path Policy、前端 FileSystem client 和另外三个 Stage 12 Rust 单体受 scope guard 保护。
- 六个本地文件命令名、参数、Serde DTO、错误文本、文件大小边界和 Data URL 格式未改变。
- File Kind 只按扩展名分类，不检查文件内容或 magic bytes；这是冻结行为，不在本 Atomic 扩大策略。
- 回退只需 revert R12-03 提交；没有数据格式、持久化内容、依赖或前端协议迁移。
- R12-03 Actions 未由用户核验绿色前不勾选 12.3，也不推进 R12-04。
