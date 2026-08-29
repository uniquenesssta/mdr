# Stage 5 / Atomic Task 5.2：Document Session Store

## 状态

- 当前状态：PASS。
- 基线：`f749eb89fcdcc25691363015c0c2987d74347d1e`（Atomic 5.1 最终 HEAD）。
- 受控 clean-runner：GitHub Actions run `31304116111`。
- Atomic 5.3 尚未开始。

## 任务边界

本节点只迁移文档会话状态所有权：metadata-only 文档记录列表、`activeId` 与只读会话事件。没有建立 5.3 文档协调器，没有改写新建/打开/激活/重命名/关闭的业务编排顺序，也没有修改冻结 `src/document/document-model.js`。

## 实施结果

### Session Store

新增 `src/features/documents/state/document-session-store.js`，成为文档会话状态唯一权威：

- 持有不可变 metadata-only records 列表；
- 持有唯一 `activeId`，并保证 activeId 只能指向当前 records；
- 提供 `getRecord/getActiveRecord/replaceRecords/insertRecord/updateRecord/setActive/removeRecord/reset`；
- 每次有效状态变化递增 `revision` 并发布冻结的 `documents:session-changed` 事件；
- no-op 不递增 revision、不发布事件；
- 重复 ID、非法 active target 在状态提交前失败；
- listener 异常通过显式 reporter 报告，已提交状态不回滚，也不静默吞掉；
- `destroy()` 幂等、清除订阅并使 Store 后续读写/订阅终止。

Store 直接使用 5.1 Document Record 契约，因此 `content/contentChunks/body/text/source/markdown` 等正文键不能进入 Store。

### Classic Session Port

新增 `src/features/documents/compatibility/classic-document-session-port.js`，只在既有 `#compatibility-business-ports` host 暴露 Session Store 公共契约：

- 不新增 `window.*` 业务全局；
- 对历史 body-bearing record 输入只投影 5.1 metadata 字段，正文不会被复制进入 Store；
- Port 不复制 records/activeId，不形成第二个状态 owner；
- 重复挂载失败，`destroy()` 删除 host property 并终止后续调用。

`src/bootstrap/module-entry.js` 在 classic application import 前创建 Session Store 并挂载 Session Port；销毁时先解绑 Port，再销毁 Store。

### Classic caller 切换

`public/app/core.js` 删除原 `let documents = []` 与 `let currentDocumentId = null` 状态权威。文档列表读取、当前文档读取、新建、打开、复制、重命名、关闭、文件树命中、上下文菜单和本地元数据持久化均通过 Session Port。

`public/app/export.js` 不再依赖 classic 隐式 `documents/currentDocumentId`，导入与另存为路径显式获取 Document Domain Port + Session Port；只有编辑器正文成功装载并完成长度校验后，才向 Session Store 提交新 record。

`public/app/preview.js` 只通过 Session Port 读取 activeId 作为虚拟预览缓存上下文，不再读取 classic session 变量。

### 正文与持久化边界

正文没有进入 Session Store。冻结 DocumentModel 仍是当前活动文档正文与事务状态权威。

为保持 5.2 前浏览器模式的多文档持久化行为，`core.js` 暂时保留一个 **classic persistence compatibility content cache**：它只按 document id 保存旧 `md_editor_documents` 序列化所需的非 native 正文，不保存任何 metadata/activeId，也不通过 Session Port 暴露。该兼容缓存是 5.3 文档协调器/Repository 迁移时必须退出的显式临时边界，不得演化成第二套 Session Store。

### Native metadata handoff

`src/storage/native-document-store.js` 不再 `Object.assign()` 修改传入 Document Record。它只维护自身 native backend session/version，并在 save result 中返回 `nativeBacked/nativeVersion`；classic 保存链收到结果后，通过 Session Store `updateRecord()` 提交 metadata。因此 frozen record 可以安全传给 NativeDocumentStore，metadata 仍只有 Session Store 一个业务状态 owner。

Rust/Tauri document_store 协议、manifest、journal、snapshot、search 与持久化格式未修改。

### 冻结边界

`src/document/document-model.js` blob SHA 仍为 `d767d9025be05a6f6b87d7cd3527782db1c3303a`，与 5.1 基线完全一致。

## 保持不变

- DocumentModel API、算法、正文、transaction journal、consumer acknowledgement；
- `md_editor_documents`、`md_editor_current_document` 等既有 storage key；
- 新建、打开、激活、重命名、关闭、导入、保存、另存为的用户可观察语义；
- native document_store Rust/Tauri 协议与数据格式；
- Preview、Theme、I18n、Help、Settings、Editor 公共接口；
- 生产依赖与 lockfile。

## 验证

同一最终候选在受控 clean-runner 实际执行并通过：

- 初始 clean worktree 与 exact 5.1 baseline 检查；
- Stage 4 handoff 全专项；
- Atomic 5.1 Documents Domain 专项；
- Atomic 5.2 Session Store/Port/Native immutable handoff 专项；
- frozen DocumentModel blob SHA 门禁；
- `npm run verify:architecture`；
- 完整 `npm test`；
- `npm run test:browser:contract`；
- `npm run build`；
- `npm run test:browser`；
- documentation layout 与 `git diff --check`。

Session Store 本身为同步状态机，不存在 async stale/cancel completion；其 revision 事件、失败前置校验、listener 异常隔离、unsubscribe/destroy 终止路径由专项测试覆盖。异步文档切换 generation/token 属于 5.3 Document Coordinator 边界，本节点未提前实现。

## 已知限制与后续边界

- classic persistence compatibility content cache 仍在 `core.js`，只为保存 5.2 前非 native 多文档正文行为；5.3 必须迁移/移除该临时缓存。
- 新建/打开/激活/重命名/关闭的编排函数仍位于 classic 模块；5.3 才建立 Document Session Controller/Coordinator 并处理异步代次令牌。
- `classic-document-session-port.js` 与 5.1 domain port 都是剩余 classic caller 的过渡边界，不能长期保留。
- Atomic 5.3 尚未开始。
