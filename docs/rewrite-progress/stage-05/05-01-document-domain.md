# Stage 5 / Atomic Task 5.1：文档领域对象

## 状态

- 当前状态：PASS。
- 基线：`49f53665d0a69f085322af7aae982f08d1f1a2fa`（Stage 4 最终 HEAD）。
- 最终兼容性复核 clean-runner：GitHub Actions run `31302457206`。
- Stage 5 已开始；Atomic 5.2 尚未开始。

## 任务边界

本节点只建立文档领域对象并迁移元数据规范化职责，不建立 Document Session Store，不复制正文，不修改冻结 `src/document/document-model.js`，不提前实现 5.2 及后续 Repository/Controller/UI。

## 实施结果

### Documents Domain

新增 `src/features/documents/` 公共领域边界：

- `domain/document-identity.js`：文档 ID 校验与兼容格式生成；
- `domain/document-title.js`：标题与 `.md/.markdown/.txt` 扩展名规范化；
- `domain/document-path.js`：可选文件路径元数据规范化，不解释平台路径；
- `domain/document-native-metadata.js`：`nativeBacked/nativeVersion` 规范化；
- `domain/document-record.js`：不可变 metadata-only Document Record 创建/更新；
- `domain/recent-file-entry.js`：保持 `{path,name,openedAt}` 持久化表面的不可变最近文件条目；
- `index.js`：唯一公开 Documents Domain 入口。

`Document Record` 明确拒绝 `content`、`contentChunks`、`body`、`text`、`source`、`markdown` 等正文键；正文仍只由现有 DocumentModel / 当前 session 兼容路径持有，本节点未建立第二份正文权威。

### Classic 迁移边界

新增 `compatibility/classic-document-domain-port.js`，只把纯 Documents Domain 操作挂载到既有 `#compatibility-business-ports` host；没有新增 `window.*` 业务全局。Port 不持有文档/session/body 状态，重复挂载失败，`destroy()` 显式解绑并终止后续调用。

`public/app/core.js` 已将以下旧规范化职责切换到该公共契约：

- 新建/复制等路径使用的文档 ID、标题、路径、创建/更新时间记录；
- 保存、重命名、native 恢复时的文档 metadata 更新；
- 最近文件 path 与 `{path,name,openedAt}` 条目构造。

classic `documents/currentDocumentId` session 状态与正文兼容对象仍保留，属于 Atomic 5.2 及后续会话迁移范围，本节点不越界重写。

### Native 元数据

`src/storage/native-document-store.js` 改为通过 `src/features/documents/index.js` 的 `normalizeDocumentNativeMetadata()` 写入 `nativeBacked/nativeVersion`，不再自行重复版本规范化规则。Rust/Tauri `document_store` 协议、manifest、正文、journal 与 snapshot 语义未修改。

### 冻结边界

`src/document/document-model.js` Git blob SHA 仍为 `d767d9025be05a6f6b87d7cd3527782db1c3303a`，与 Stage 4 基线完全一致。

### 历史持久化兼容性复核

关闭审计确认 Stage 4 的 `loadDocumentsFromStorage()` 仅要求既有 `doc.id` 为 truthy，旧 recent/native/timestamp 路径也没有额外的安全整数、非负数或字符集限制。5.1 最终实现因此只对**新生成**文档 ID 保持安全格式约束，不会重写或拒绝已载入的既有 ID；Document Record 更新允许历史记录缺少 `createdAt`，并保持旧运行态对 `updatedAt`、`nativeVersion`、`openedAt` 数值的宽容转换语义。该修正只解除 5.1 初版新增的过严约束，不扩展旧实现能力，也不修改任何 storage key/字段名。

## 保持不变

- DocumentModel API、算法、版本、transaction journal、consumer acknowledgement 与正文语义；
- `md_editor_documents`、`md_editor_current_document`、`md_editor_recent_files` 等现有持久化 key；
- 最近文件 `{path,name,openedAt}` 字段表面与上限/排序/去重策略；
- native `nativeBacked/nativeVersion` 运行态字段表面；
- 文件打开/保存、编辑器、Preview、Theme、I18n、Help、Settings、Rust/Tauri 公共接口和用户可观察行为；
- 生产依赖与 lockfile。

## 验证

同一最终候选在受控 clean-runner 中实际执行并通过：

- 初始 clean worktree / exact Stage 4 baseline 检查；
- Atomic 5.1 Documents Domain 单元与生产集成专项；
- 历史 document id、缺失 `createdAt`、fractional/negative recent/native 数值兼容性专项；
- 冻结 DocumentModel blob SHA 门禁；
- `npm run verify:architecture`；
- 完整 `npm test`；
- `npm run test:browser:contract`；
- `npm run build`；
- `npm run test:browser`；
- documentation layout 与 `git diff --check`。

Documents Domain 为同步纯逻辑，不存在 async stale/cancel 路径；其唯一生命周期对象 classic compatibility port 的重复挂载、destroy、终止后调用均由专项测试覆盖。

## 已知限制与后续边界

- classic `core.js` 仍持有 documents 数组、active document id 与临时正文兼容对象；这是任务书 Atomic 5.2 起的 Document Session Store / Repository 迁移范围，不在 5.1 内提前处理。
- `classic-document-domain-port.js` 是剩余 classic document caller 的显式过渡边界，必须随 Stage 5 classic caller 迁移退出，不能成为长期第二套 API。
- Atomic 5.2 尚未开始。
