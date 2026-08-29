# R10-10 Load Controller

Atomic 10.10 将持久化文档读取、generation 校验、DocumentModel/editor 激活和 Documents Session 提交迁入 `src/features/persistence/application/load-controller.js`。Documents 继续唯一拥有生命周期 operation generation；Load Controller 不保存正文、不创建第二份 generation，也不直接绕过 DocumentModel 写 editor。

`DocumentSessionController`、关闭邻居恢复和只读非活动文档读取均改为调用 Load Controller；旧 `DocumentOpenCoordinator` 只保留新建/导入正文激活。repository/native/browser 格式、公共经典文档命令和冻结模型契约保持不变。R10-11 Close Save 未提前实施。

本 Atomic 验证门槛：R10-10 10/10、R10-09 10/10、Stage 5 文档控制器 11/11、R10-08 8/8、R10-07 10/10、R10-06 11/11、R10-05 9/9、完整 Node 323/323、架构/legacy/generated/README、browser contract 10/10、build、built-app 29/29、npm audit high 和冻结文件 diff。仅在这些验证全部通过后生成 Atomic 提交。

未执行 `npm run test:integration`：当前 `package.json` 没有该脚本。未修改 Rust、Rust 接口、持久化格式、依赖或 package 文件，因此本 Atomic 不重复执行 Rust test/clippy/check。
