# R12-19 保存提交与缓存一致性（A07/A08/A09）

状态：实现完成，Windows 验证待运行。只实施 12.19；8 个冻结 JS 模型、IPC DTO、持久化格式及恢复算法保持不变。

## 提交与失败边界

- BrowserDocumentRepository 写入失败报告并抛出原错误，正文缓存保留；SessionDocumentRepository 只准备正文，不提前清除 dirty。
- NativeSaveSession 确认后端正文版本并推进增量消费位置；DocumentSessionController 在正文与必要会话元数据均写入后才调用冻结模型的 markPersisted。原生队列发出 body-saved，不能冒充整次保存完成。
- 元数据晚失败保留模型正文与 dirty；原生正文已经成功时，重试可直接补会话索引。原生响应错误可能发生在已写入后，因此下一次用完整快照重置，避免重复应用增量。
- 保存中出现新编辑时保留 dirty，并阻止切换/关闭；选中文档及关闭索引失败向上传播，回滚可恢复当前正文。
- Rust 失败保存丢弃租约中的候选缓存。下次同进程读取/重试通过现有磁盘恢复逻辑判定实际已提交版本，不假设错误必然代表未写入。
- ASCII 大小写别名继续共用 admission 锁；每次签出使其他拼写缓存失效，保留原路径读取。这样默认 Windows 别名不会留下旧缓存，又不会合并大小写敏感目录的不同正文。

## 验证矩阵

| 层 | 故障与检查 | 证据类型 |
|---|---|---|
| JS 完整保存链路 | 配额/拒写、索引晚失败、activeId 晚失败、标题失败、native 正文成功索引失败、原版本重试 | 注入 Web Storage / IPC；真实生产控制器、仓库及冻结模型 |
| JS 生命周期 | 切换/关闭/新建保存失败、选择索引晚失败、保存中继续编辑、窗口关闭拒绝与重试 | 注入外部存储，真实控制器链路 |
| Rust 事务 | 后续事务非法，不发布已应用的前半部分 | 真实生产事务算法与磁盘 |
| Rust journal | 打开、部分写入、同步前错误 | 测试专用边界注入；真实 journal 文件和恢复 |
| Rust snapshot | content/meta/journal reset 的 create/write/sync/replace 共 12 个边界 | 测试专用边界注入；真实 AB 文件和恢复 |
| Windows IO | 独占 journal 句柄拒绝打开、快照替换目标独占、三个阶段临时路径被目录占用 | 真实 OS 文件系统拒绝，非 mock |
| Rust 失败后 | 同进程 cache/disk 一致、再次保存、新 Store 模拟重启读取 | 真实文件回读；未声称进程崩溃测试 |
| Windows 别名 | 大小写别名读取/保存/删除无旧缓存 | 默认不区分大小写的真实路径 |
| 大小写敏感身份 | 两个独立目录、大小写拼写键隔离 | 独立真实目录模拟身份；不声称启用 Windows 目录大小写敏感标志 |

Context7 核对 Rust Windows OpenOptionsExt::share_mode(0) 的独占共享语义；项目 Rust 1.88。Mermaid Chart 梳理实际保存责任链。测试专用故障代码由 cfg(test) 排除于产品构建。

## Windows 结果

待回填。原 R18-N01 Preview 循环依赖仍归 R12-22，架构门禁保留失败；不在本轮修复或豁免。
