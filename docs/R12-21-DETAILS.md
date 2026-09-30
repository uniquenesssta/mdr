# R12-21 用户文件安全写入整改（A06）

状态：修正提交 `cde35b8cd3f46d86791653cd7488bb77a40a19ae` 的 Windows 专项已验收，A06 已关闭；R12 整体尚未验收。分支 `agent/r12-stage`，基线为 R12-20 验收记录提交 `35dbb831a294c3762f8738f20dbbb6665ec85732`。

## 写入责任与契约

`text_writer` 保留 UTF-8 编码、字节数及 `无法写入文本文件：` 映射，`binary_writer` 保留 Base64 解码、字节数及两个原错误前缀；二者共同调用唯一 `atomic_writer::write_bytes`。命令、DTO、前端端口、Base64 先于路径校验的顺序、空内容、新建/覆盖和不创建父目录的行为不变，没有新增依赖或修改冻结模型。R14 导出必须复用现有文件端口及此提交权威，不另建直接截断写入器。

共享写入过程：解析既有父目录和文件目标 → 检查普通文件、只读及不截断的写权限 → 同目录 `create_new` 独占临时文件 → 完整写入 → `sync_all` → 关闭句柄 → 再查目标权限 → Windows 替换。目标存在时，写入前及提交前复制 DACL 与继承保护状态，复制失败阻止提交；避免以父目录的重命名权绕过目标写 ACL 或把受限文件替换为更宽权限。现有文件符号链接解析到实际文件，保留跟随链接的正常语义；拒绝目录、缺少父目录、Windows 设备名、ADS 流名及尾部点/空格等无效文件目标。

Windows 提交直接调用 `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)`，临时文件和目标同目录，不启用跨卷复制，不先删除原文件，不重试忽略只读的替换。已核对 Rust 1.88 实现：`std::fs::rename` 在访问拒绝时可能进入 POSIX 语义的备用替换，因此本边界明确使用 Windows API；失败仍向原命令传播。FFI 仅包含路径缓冲区和安全描述符读取/复制，有对应缓冲区生命周期与对齐的 SAFETY 注释，由 Windows 全量编译、Clippy 和真实替换回归验证。

## 失败与恢复

写入、同步或替换失败时先关闭本次临时句柄，再删除本次拥有的临时文件；不清理其他保存或旧会话的文件。清理也失败时，错误同时保留原故障、清理故障和具体临时路径，供用户恢复；完整写入并同步后的临时文件可作为新正文的恢复副本，早期写入失败的副本可能不完整。原文件仍可读取/重试；释放占用或恢复权限后可再次保存。

异常退出/进程终止可能留下 `.mdr-save-<pid>-<nonce>.tmp`。不自动将其覆盖到目标，也不扫描删除旧会话的恢复副本。正常失败报告恢复路径；崩溃后的残留需检查内容后人工恢复或清理，不能仅凭文件名认定是完整版本。panic 路径通过 Drop 尝试关闭和清理，没有返回通道时清理仍可能失败。

这是避免先截断原文件的提交策略，不承诺所有断电、设备缓存、网络文件系统或外部并发修改下绝对安全。`sync_all` 同步临时文件，Windows 替换标志不等于通用目录持久化保证。成功替换会改变文件身份：硬链接别名不会自动接收新字节；DACL 保留不等于保留所有者、SACL、命名流、EFS/压缩属性或所有历史元数据。多个并行保存只允许完整负载发布，可能因占用失败或由最后一次提交覆盖；本项没有引入跨进程文件事务/版本冲突协调。

## Windows 回归矩阵

新文件 `src-tauri/tests/local_file/atomic_writer.rs` 在真实生产模块内执行，18 个测试，不复制提交实现。

| 场景 | 证据方式 | 主要断言 |
|---|---|---|
| 新建、中文路径、文本/二进制覆盖、空内容 | 真实 Windows 文件系统与两个 Writer | 完整字节、原字节数、无临时残留 |
| 部分写入、同步前故障、替换前故障 | 仅 `cfg(test)` 的阶段故障注入 | 原字节未变、清理、同进程重试；新文件失败不发布 |
| 缺少父目录、目录目标、设备/流/无效名称 | 真实路径校验 | 不创建目录或旁路目标，不改变原字节 |
| 目标占用 | 真实 Windows 句柄允许写但不共享删除 | 已到替换阶段且 OS 拒绝；释放后重试 |
| 只读、同步后变为只读 | 真实 Windows 文件属性 | 原字节、属性保留，错误不伪成功 |
| 写 ACL 拒绝 | `icacls` 在测试自有文件拒绝当前 SID 的写/追加 | 父目录可重命名仍不能绕过；恢复 ACL 后重试 |
| 受保护 DACL | 真实 ACL 设置及替换前后 `icacls` 对照 | 内容更新而 DACL/保护语义保留 |
| 清理失败 | 同步后独占删除权限的真实占用句柄 + 替换故障注入 | 原文件未变，完整恢复字节仍在，错误报告路径 |
| 无效 Base64 | 真实 Tauri 命令 | 解码错误先返回、原文件未变、无临时文件 |
| panic、并发保存、旧恢复副本 | 故障注入及真实并行文件写入 | 正常可清理、最终单个完整负载、旧副本未动 |

原文本 4 项、二进制 6 项和命令 12 项保持。累计 Windows 工作流沿用 `.github/workflows/r12-14.yml`，显示名更新为 R12-21，新增精确 18 项专项门禁；原全部 Node/Rust/架构/依赖/构建/浏览器与原生门禁保留，不忽略 Preview 的既有 R18-N01。Rust 全量预期由 250 增至 268，但预期数量不代表已通过。

## 验证状态和续接

提交 `4853eaeefdb3032bcdc293eb3bc59167647e75ed` 的 [Windows Actions 36680764895](https://github.com/uniquenesssta/mdr/actions/runs/36680764895) 已完成：安全写入专项 18/18、文本 4/4、二进制 6/6、命令 12/12、Rust 全量 268/268，Rust 格式和 cargo check、构建、浏览器、原生链接通过。整体 CI 仍失败，原因和本次修正如下：

| 失败原因 | 修正或责任 |
|---|---|
| R12-08 清单测试固定要求 12 个模块，本轮实际增加到 13 个 | 用明确职责模块路径集合代替历史数量，加入 `atomic_writer`；保持全仓真实清单校验、唯一性、精确文件集合对照，并把新模块纳入私有边界检查 |
| 只读测试恢复时调用 `set_readonly(false)`，Rust 1.88 Clippy 在 Windows 也拦截此调用 | 修改属性前保存原 `fs::Permissions`，Drop 用 `set_permissions` 恢复原属性；不添加 allow、不降低 `-D warnings`，两个真实只读测试及重试断言保留 |
| 既有 R18-N01 Preview 循环依赖 | 仍归 R12-22；架构/全仓 Node 保留失败，不在本次提前修改生产链路 |

修正提交只改上述两个测试及进度记录，安全写入生产实现、全部测试数及 Windows 工作流门禁不变。已核对 [Windows Actions 36686262120](https://github.com/uniquenesssta/mdr/actions/runs/36686262120)：安全写入 18/18、文本 4/4、二进制 6/6、命令 12/12、Rust 全量 268/268、Clippy `-D warnings`、rustfmt、cargo check、release build、前端构建、浏览器与原生链接均通过。递归全仓 Node 1466/1467，唯一失败为既有 R18-N01 Preview 循环依赖；整体 run 因此仍为 failure。R12-21 专项已验收，不将整体失败误写为全绿。

本地仅有远端精确文件快照，非完整 Git 历史。本地执行 Rust 1.88 rustfmt 静态解析/格式检查、修改 JS 的 `node --check`、工作流 YAML 与 shell block 静态语法、JSON/模块清单和相对文档链接校验、`git diff --check`。未在 Linux 执行产品测试、编译、构建、浏览器或平台验收；真实文件权限、OS 替换和全部累计门禁只以精确提交的 Windows Actions 结果为准。

[机器可读记录](audit/r12-21-safe-write.json) 保存修正提交及 Windows 结果。12.21 已勾选、A06 已关闭；R18-N01 归 R12-22，R12 整体尚未验收。

按用户要求，推送触发 Actions 后立即结束会话，不轮询；约 15 分钟后由用户发起“查询 R12-21 CI”。回退仅撤回本项共享写入、测试和工作流/记录调整，不撤回 R12-20 及前序已验收修复；回退会重新引入 A06 截断风险，不作为正常故障恢复办法。

## API 依据

- [Rust 1.88 Windows rename 实现](https://github.com/rust-lang/rust/blob/1.88.0/library/std/src/sys/fs/windows.rs)
- [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)
- [GetFileSecurityW](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-getfilesecurityw)、[SetFileSecurityW](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-setfilesecurityw)、[GetSecurityDescriptorControl](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-getsecuritydescriptorcontrol)
