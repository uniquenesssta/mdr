# R10-11 Close Save Controller

- 实现：新增 `src/features/persistence/application/close-save-controller.js`，唯一负责关闭前取消待执行 Autosave、调用 SaveController 强制最终快照、判定保存结果及保存失败后的用户决策；不持有正文、DocumentModel、NativeSaveQueue/Session、计时器或 Window 关闭状态。
- 集成：Persistence 公共入口导出并由 `src/main.js` 组合一个实例；Window 继续只调用 `CloseSavePort.prepareClose()`。旧 `public/app/events.js` 的 CloseSavePort 注册/保存失败提示实现已删除，Autosave 编辑事件调度保留。
- 兼容：最终保存继续使用当前标题、`forceSnapshot: true` 与 `snapshotReason: close-save`；保存失败仍显示“保存失败 / 仍然关闭 / 返回编辑”的原有决策语义。取消、过时或销毁后的保存结果不会放行关闭。
- 范围：未修改 Stage 10 冻结文件、Rust、DTO、持久化格式、package/lockfile；R10-12 旧保存代码清理未提前实施。
- 验证：GitHub Actions run `32124111179` 成功：R10-11 10/10、R10-10 10/10、R10-09 10/10、Documents 11/11、R10-08 8/8、R10-07 10/10、R10-06 11/11、R10-05 9/9、完整 Node 333/333、`npm audit --audit-level=high` 0 漏洞、Architecture/No-Legacy/Generated/README 全部通过、Browser Contract 10/10、Production Build 通过、Built-app Browser 29/29、验证结束 tracked tree clean。`npm run test:integration` 当前不存在；本 Atomic 未改 Rust/DTO/持久化格式，因此未重复执行 Rust test/clippy/check。
