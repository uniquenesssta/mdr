# R11-16 — 删除单体并切换目录入口

## 状态与范围

- 沿用 `agent/r11-stage`，实现基线为已绿的 R11-15 提交 `c9377d9d6653e863056ad6aa1524749a283c8b2b`。
- 删除旧 `src-tauri/src/document_store.rs`，以 `src-tauri/src/document_store/mod.rs` 作为唯一模块入口；没有保留兼容壳、备用入口或第二份实现。
- R11-16 已完成验收：提交 `5efc57865aa162b5948054b7dc1a5c10e17fd026` 的 [Actions #33239806668](https://github.com/uniquenesssta/mdr/actions/runs/33239806668) 两个 job 与全部步骤成功；Stage 11 已闭环，允许开始 Stage 12。

## 实现

| 范围 | 结果 |
| --- | --- |
| 目录入口 | 原入口内容迁至 `document_store/mod.rs`，入口只声明子模块、导出 `DocumentStore`/命令边界并解析 Tauri 数据根目录；不拥有运行时状态或存储算法。 |
| 单体删除 | `src-tauri/src/document_store.rs` 已删除，Rust 的 `mod document_store;` 只解析目录入口。 |
| 唯一实现 | 新增结构门禁，逐一确认 `DocumentStore`、`document_root`、Store 两个内部编排函数和 10 个 Tauri 命令均只有一个生产提供者。 |
| 调用与兼容 | 命令注册保持原路径；当前源码兼容检查改读 `mod.rs`。冻结夹具中的 `sourcePath: src-tauri/src/document_store.rs` 继续作为 R11-01 历史来源证据，未被改写。 |
| 模块清单 | 将旧单体记录替换为目录入口，并补齐当前 32 个文档存储生产模块的职责、状态所有者和生命周期；现行清单从 394 项增至 425 项，历史阶段记录数字不改写。 |
| CI 路由 | R11-16 接管 `agent/r11-stage` 自动验证；R11-15 改为手动复验，R11-14/R11-15 的 Rustfmt 路径同步到目录入口。 |

未修改 Store、缓存、快照、journal、索引、分块、repository、DTO、10 个命令签名、前端端口、生产依赖、锁文件或冻结磁盘夹具。

## 验证

| 检查 | 实测结果 |
| --- | --- |
| 目录切换与唯一实现定向门禁 | 10/10 通过。 |
| Rust 1.88 真实存储模块 | 99/99 单元通过，冻结兼容 5/5 通过，共 104/104。临时验证目录首次缺少只读夹具链接导致 4 项 ENOENT；恢复同一仓库夹具链接后全部通过，未修改生产实现或夹具。 |
| 完整 Node 回归 | 354/354 通过。生产模块清单补齐后同步更新两个精确当前数量断言；R10 历史 394 记录保持不变。 |
| 构建与架构 | `npm run build` 通过；architecture、no-legacy-runtime、generated-files、readme-record 四项门禁通过。 |
| 格式与工作流 | Rust 1.88 `rustfmt --check` 通过；R11-16 工作流保持固定事件 SHA、只读权限、硬失败和失败证据上传。 |
| 本地未运行 | 当前容器未提供完整 Linux Tauri 系统构建环境及 Chrome；完整 Cargo/Clippy/check、browser contract/app 交由 Actions。依赖准备脚本被当前网络审批拦截，测试与构建使用已存在的锁定父目录依赖。 |

远端 Actions 已补齐上述本地未运行项：完整 Tauri/Rust tests、Clippy `-D warnings`、Cargo check、browser contract/app、依赖审计与 tracked-diff 检查均成功。

## 契约与回退

- 外部命令、Serde 字段、UTF-16 偏移、A/B 快照、journal、上传文件名、恢复提示与错误文本保持不变。
- `main.rs` 仍只依赖 `document_store` 公共入口；命令适配器只依赖 Store，Store 再调用缓存及各持久化模块。
- 回退只需 revert R11-16 提交；磁盘格式未变，无数据迁移或回滚步骤。R11-16 Actions 与阶段 11 清单均已验收，Stage 12 可以开始。

## 架构核对

Mermaid Chart 核对了现行链路：`main.rs -> document_store/mod.rs -> commands/store -> cache + snapshot/journal/index/chunks/repository`。目录入口没有吸收已拆分职责，也没有形成旧入口与新入口并存。
