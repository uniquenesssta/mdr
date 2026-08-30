# R12-04 — Text/Image Readers

## 状态与边界

- 基线为已通过 R12-03 专属 Actions 的 `d93a5b2164b28731d5b542ead251a5839d6c69e0`，继续使用 `agent/r12-stage`。
- 新增 `src-tauri/src/local_file/text_reader.rs`，唯一负责冻结的 20MB 拖入文本上限和 UTF-8 解码。
- 新增 `src-tauri/src/local_file/image_reader.rs`，唯一负责冻结的 5MB 拖入图片/20MB 嵌入图片限制、图片字节读取和带 File Kind MIME 的 Data URL 编码。
- Reader 不分类或解析路径，不暴露 Tauri command，不构造 `DroppedFile`/`LocalImageData` DTO，也不持有目录树或写入职责。
- R12-05 Writers 及后续职责没有提前迁移。

## 迁移结果

| 调用入口 | Reader 用途 | 保留行为 |
|---|---|---|
| `read_dropped_file` 文本分支 | `text_reader` 在大小通过后以 UTF-8 读取 | 20MB 等值允许、超限错误和读取错误前缀不变；无效 UTF-8 明确失败。 |
| `read_dropped_file` 图片分支 | `image_reader` 检查 5MB、读取字节并编码 Data URL | File Kind 提供 MIME；Data URL、大小边界、错误和 DTO 不变。 |
| `read_local_image` | 先检查 20MB，再由 File Kind 分类，最后读取编码 | 超限仍先于不支持格式返回；路径、MIME、字节数和错误文本不变。 |
| `list_text_file_tree` | 复用 `text_reader` 的文本大小谓词 | 不可读文件仍由原树扫描策略处理；目录职责未提前迁移。 |

旧 `local_file.rs` 的生产区已删除 `fs::read_to_string`、图片 `fs::read` 和 Base64 encode，不保留第二份读取权威。二进制写入仍按冻结行为使用 Base64 decode，留给 R12-05。

## 验证

| 验证 | 结果 |
|---|---|
| Reader 直接 Rust | 文本 4/4、图片 6/6；由 R12-04 Actions 使用 Rust 1.88 通过。 |
| 定向 Node | R12-01 至 R12-04、FileSystem adapter 和 workflow 路由共 33/33 通过。 |
| 全量 Node | 376/376 通过。 |
| 架构门禁 | `verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files` 通过；生产模块清单由 427 增至 429。 |
| 构建与依赖 | `npm run build` 通过；`npm audit --audit-level=high` 为 0 个漏洞。 |
| 浏览器 | R12-04 Actions 的 browser contract 与 built-app browser regression 通过。 |
| Rust | Reader 10/10、File Kind 6/6、Path Policy 10/10、R12-01 行为 10/10、独立兼容夹具 6/6、全量 Rust、Clippy `-D warnings` 和 Cargo check 通过。 |

## 契约、风险与回退

- 没有新增 crate 或 npm 包，Cargo/npm manifest 与锁文件未修改；`main.rs`、三个其他 Stage 12 Rust 单体、Path Policy、File Kind 和前端 FileSystem client 受 scope guard 保护。
- 六个本地文件命令名、参数、Serde DTO、错误文本、文件大小边界、校验顺序和 Data URL 格式未改变。
- Reader 按 File Kind 已完成的扩展名/MIME 分类读取，不增加 magic-byte 判断；无效 UTF-8 文本会保留为读取错误，这是冻结行为。
- 回退只需 revert R12-04 提交；没有数据格式、持久化内容、依赖或前端协议迁移。
- 最终提交 `d92f8393b197544f3332da1e8324003e62d35ceb` 的 [Actions #33294085755](https://github.com/uniquenesssta/mdr/actions/runs/33294085755) 两个 job 与全部步骤成功；R12-04 已由用户核验完成，允许进入 R12-05。
