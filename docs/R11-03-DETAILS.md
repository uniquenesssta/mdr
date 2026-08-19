# R11-03 — Document Store Validation / Paths

- 基线与前置：本 Atomic 以 R11-02 收口提交 `0cbcc2000afcb928da57ab5c6aeebf87321036b3` 为唯一回退点；R11-02 实现树 `ee1e2533f4811d6a497460d166f07ffa7270c449` 已在 Actions run `32247930108` attempt 2 全门禁通过。`agent/r11-stage` 在 R11-03 开始前与该收口提交一致，没有并行提交需要保护或合并。
- 任务书依据：执行 Stage 11 Atomic 11.3 Validation/Paths。目标仅是把文档 ID、增量版本、UTF-16 文本修改范围，以及文档目录/快照/日志/分段上传文件名布局从 `document_store.rs` 提取到独立职责模块；必须保持既有错误文本、命令、DTO、磁盘布局、恢复、UTF-16 和 Mutex 语义。
- Validation 边界：`src-tauri/src/document_store/validation.rs` 负责 `safe_document_id`、增量保存版本门禁、UTF-16 事务范围到字节范围映射。事务排序与正文替换仍由当前 store 编排执行，避免把状态修改责任塞入 validation。精确冻结 `文档标识无效`、`VERSION_MISMATCH:<current>:<base>`、`文档版本未前进`、`文本修改范围无效`、`文本修改位置落在代理字符中间`、`文本修改位置超过文档长度`。
- Paths 边界：`src-tauri/src/document_store/paths.rs` 只拥有 `documents/<safe-id>`、`snapshot-{slot}.md`、`snapshot-{slot}.json`、`changes.jsonl`、`snapshot-upload-<safe-id>.tmp` 的稳定路径/文件名构造。目录创建和全部文件 IO 仍留在当前 store，等待 R11-04 Repository 统一接管，避免提前跨 Atomic 抽取 repository 职责。
- 编排保持：`document_store.rs` 仅改为调用 Validation/Paths 公共边界；`document_root` 仍先执行文档 ID 规范化，再解析 Tauri app-data，再 `create_dir_all`，保持原错误顺序与副作用。保存时仍在缓存加载后执行版本检查；journal replay、snapshot A/B、搜索索引、上传 IO、命令注册和 Mutex 范围均不调整。
- 兼容夹具：R11-01 fixture 的来源 commit/blob/磁盘 bytes 不变。`document_store_compatibility.rs` 的源码词法扫描仅扩展到 `validation.rs` 与 `paths.rs`，使原冻结格式词汇在职责迁移后继续被同一 5/5 兼容夹具校验；不改变 fixture 或兼容算法。
- 新契约测试：Validation 7 项覆盖 ID 过滤/160 字符上限/精确错误、版本 mismatch/未前进/完整快照 bypass、中文+Emoji UTF-16 字节范围、反向范围、代理字符中间和越界错误；Paths 2 项冻结 documents 目录、snapshot A/B 文件名、journal 文件名、上传临时文件名及无效 upload ID 错误。
- 受保护范围：不修改 `src-tauri/src/main.rs`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、package 依赖、`document_store/types.rs`、R11-01 fixtures、已冻结 R11-01/R11-02 workflows、Tauri command names 或冻结模型。无删除候选、无新生产依赖。
- 验证：`.github/workflows/r11-03.yml` 使用收口提交 `0cbcc2000afcb928da57ab5c6aeebf87321036b3` 作为 scope base，验证真实 PR head；执行 R11-03 Validation 7/7、Paths 2/2、R11-02 JSON 4/4、R11-01 compatibility 5/5、完整 Rust、Clippy `--deny warnings`、cargo check、npm audit、R10-12 11/11、Node 344/344、architecture/documentation、Browser 10/10、production build、Browser 29/29 与 clean-tree。当前状态：实现提交后等待真实 CI，全部通过前不收口、不进入 R11-04。
