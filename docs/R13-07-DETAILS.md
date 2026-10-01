# R13.7 Image Controller

状态：实现已提交，**待精确提交 Windows CI，未验收**。唯一分支 `agent/r13-stage`；前置与回退代码基线 R13.6 `073c59bb105f877913272ddc61860914a7a7386e`，Windows CI 36855278836 七个 job 全部成功。

## 实际所有权与调用链

新增 `images/image-import-controller.js`，从 Import 公共入口导出 createImageImportController 与 isImageImportCancelled。实例接收浏览器/原生读取函数，拥有当前读取、取消控制器与代次，提供 readFile/readPath、createInsertion、cancel/destroy；不读取 editor DOM、不构造 Markdown 字符串。

File 读取先使用 R13.6 唯一策略，再通过已支持 signal 的 Browser File Reader 读取 Data URL；保留 image/*、5 MiB 上限和对话框大于 2 MiB 确认。原生路径通过 main 注入 FilesPort.readImage，保留 Rust 20 MiB 与扩展名规则，另一个 dropped-file 5 MiB 分支不变。URL 维持直接插入地址、不主动下载的原语义；显式插入请求携带 URL、alt 与选择区，Markdown 转义仍归现有 Editor 命令，13.8 再迁移。

main 创建拖放专用 Controller，经现有 scoped Drop Import port 供 events 调用；删除 events 的 FileReader 和原生图片直接调用，只保留结果检查、现有插入命令及本地化通知。不再暴露已无调用者的 assessImage 桥方法。main 两个退出路径销毁图片 Controller；桥卸载后拒绝新读取。

图片对话框获得独立实例，由 View 生命周期负责销毁。View 只持有预览数据与选择区，调用 Controller 读取/生成插入请求；关闭按钮、Modal Shell onClose、换图、空选择、非法/超限选择、切回 URL 及 destroy 都使旧读取失效并清空预览/待插入数据。View 代次保护读取 Promise 已完成、UI 回调尚未执行的间隙；失败或拒绝不能继续插入上次上传。原有确认提示和编辑命令保持。

## 取消与限制

Drop Import 在新 dispatch 和销毁时取消上次 request.signal；文本代次检查保留，图片 Controller 接收该信号。浏览器取消会清理 FileReader 回调并在读取中调用 abort，重复取消无重复副作用。图片错误与取消分别处理，取消不显示读取失败。

原生 IPC 当前没有物理中止接口；Controller 通过取消 Promise 及时结束等待，原生 I/O 可能继续，但迟到成功/失败都被隔离，不能插入、覆盖预览或显示旧错误。这不是新增底层取消接口。destroy 为终态；已释放的 Controller 不接受新读取/插入请求。两处独立实例不会互相取消。

## 验证

- 新增 Controller 的 File/native 成功、URL 请求、冻结结果、策略拒绝、确认拒绝、预取消、读取失败/同步异常/abort、替换/父信号/destroy、回调清理及晚到结果回归。
- 新增真实 View 行为回归：慢读取遇换图、关闭、Shell 关闭、切 tab、空选择、非法选择与销毁；成功后再失败/超限不得插入旧数据。
- 原导入矩阵改用真实 Image Controller + Browser File Reader；保留文本优先、MIME/阈值、确认、原生路径、错误提示与代次/最近文件场景，异步结果改为等待断言。
- 更新三条平台旧接线断言，保留客户端命令映射、平台无业务状态与 Rust MIME 边界；实际 main 组合测试覆盖浏览器 Data URL 与 desktop readImage 接线和销毁后拒绝。
- 既有 Windows 浏览器 FileReader E2E 增加真实 File 图片 Data URL 与销毁取消，不另建 CI；生产清单追加一个模块。
- 本地仅 JS/MJS 语法、JSON/相对导入和差异静态检查。完整产品测试与构建只运行现有七组 Windows CI，启动即停止，不轮询，成功前不勾选 13.7。

未改 Rust、依赖、模型或持久化格式；复用现有平台 API，无新增第三方 API。Mermaid Chart 已复核读取/取消所有权。R13.8 字符串工厂、13.13/13.14 桥删除与 A05/R13-S01、A03、A10 移交保持。

