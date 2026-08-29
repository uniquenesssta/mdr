# R12-01 — 安全行为夹具

## 状态与基线

- Stage 11 已在提交 `b8ee68b93cf51f45835ac837cad8110aeea24ad0` 闭环；Stage 12 从该提交建立独立 `agent/r12-stage`，没有继续写入 `agent/r11-stage`。
- 本 Atomic 只冻结拆分前行为：生产命令、参数、返回 DTO、运行时路径和依赖均未改变；后续目录拆分由独立 Atomic 接续。
- R12-01 实现、本地门禁与专属 Actions 均已完成；远端绿色结果由用户于 2026-08-29 核验，未伪造或补写当前环境无法读取的运行编号。

## 夹具与测试

- `src-tauri/tests/fixtures/stage_12_security/manifest.json` 固定 Stage 11 闭环提交、四个拆分前 Rust 源 Blob 和 Cargo/npm 依赖文件 Blob。
- manifest 记录：文本扩展、图片 MIME、三个字节上限、目录树深度与条目上限、边界比较、符号链接/不可读/空目录/排序策略、外链协议、网页请求头/重定向/超时/响应字段、日志写入模式/字段/上限和九个命令名。
- 四个旧 Rust 文件仅增加 `#[cfg(test)]` 测试，共 10 个 `stage_12_` 直接行为用例：本地文件 4、外链 2、网页 2、性能日志 2。测试直接调用现有私有函数和常量，没有复制生产实现。
- `stage_12_security_compatibility.rs` 提供 6 个独立只读契约测试，并通过 `include_str!` 同时约束当前实现符号；Node 契约另提供 7 个可在无 Tauri 系统库环境运行的交叉检查。
- R11-16 工作流改为仅手动复验，R12-01 成为 `agent/r12-stage` 唯一自动阶段门禁；R11-16 原有验证步骤和证据保留策略没有删除。

## 已冻结的事实

| 边界 | 拆分前行为 |
|---|---|
| 本地文本 | `md`、`markdown`、`txt`，大小等于 20 MiB 允许，超过拒绝。 |
| 拖入图片 | `png`、`jpg/jpeg`、`gif`、`webp`、`svg`；等于 5 MiB 允许，超过拒绝。 |
| 混合编辑图片 | 同一 MIME 表；等于 20 MiB 允许，超过拒绝。 |
| 文件树 | 根深度 0，深度上限 24、扫描条目上限 12,000；符号链接跳过且不计 `skippedCount`，不可读的受支持文件跳过并计数。 |
| 外链 | trim 后使用 `url::Url`；仅 `http`、`https`、`mailto`、`tel` 可进入平台 opener。 |
| 网页抓取 | 裸地址补 `https`；最多 10 次重定向、总超时 30 秒，仅 2xx 成功，空文本拒绝。 |
| 网页响应现状 | `Content-Type` 只写入 `content_type` 字段，不执行 allowlist；响应体由 `Response::text()` 读取，当前无字节上限。该事实是后续风险基线，不代表已完成安全增强。 |
| 性能日志 | debug 追加 JSONL、release 不写；每批最多 500 条、每条序列化后最多 64 KiB。命令当前接收任意 JSON 值，Rust 侧没有脱敏；前端已有字段清洗但不是敏感字段红删。 |
| 命令 | 6 个本地文件命令加 `open_external_url`、`fetch_url`、`write_performance_logs`，共 9 个，名称不变。 |

## 验证

| 验证 | 结果 |
|---|---|
| 定向 Node 契约 | 34/34 通过。 |
| 全量 Node | 361/361 通过。首轮发现并修复 R11-16 已归档后旧测试仍要求其自动 push、以及阶段切换后根 README 丢失 Stage 10 交接语义的历史断言；没有删除或弱化测试。 |
| 架构/文档门禁 | `verify:architecture`、`verify:no-legacy-runtime`、`verify:generated-files`、`verify:readme-record` 通过。 |
| 构建 | `npm run build` 通过。 |
| Rust 格式 | 离线 Rust 1.88 `rustfmt --check` 通过。 |
| Workflow | R11-16/R12-01 YAML 解析通过；路由契约确认 R11-16 仅手动、R12-01 仅随 `agent/r12-stage` 自动运行。 |
| 本地 Cargo | 已下载锁定 crate 并进入编译；容器缺少 `pkg-config`/`glib-2.0` 等 Linux Tauri 系统库，停在 `glib-sys` 构建脚本，未进入项目测试。Actions 会先安装完整系统依赖再执行 10/10 直接测试、6/6 兼容夹具、全量 Rust、Clippy `-D warnings` 和 Cargo check。 |
| 浏览器 | 当前容器未提供 Chrome；browser contract/app 交由 Actions。 |
| 专属 Actions | 用户已核验 R12-01 绿色，Atomic 完成。 |

## 契约、风险与回退

- 没有新增 crate 或 npm 包；`Cargo.toml`、`Cargo.lock`、`package.json`、`package-lock.json` 由 fixture Blob 和 CI scope guard 双重锁定。
- 当前未过滤网页 Content-Type、未限制网页响应体字节数、Rust 日志命令未脱敏是被夹具记录的拆分前事实，不在 R12-01 越权修改；后续任务若按任务书实施安全策略，必须显式更新测试、记录兼容影响并独立验收。
- 回退只需 revert R12-01 提交；没有数据格式、持久化内容或运行时迁移。
- R12-01 已勾选任务书完成项；工作流保留 `workflow_dispatch` 人工复验能力，自动阶段门禁已交接给 R12-02。
