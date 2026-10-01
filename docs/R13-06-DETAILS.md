# R13.6 Image Policy

状态：**已验收**。实现提交 `073c59bb105f877913272ddc61860914a7a7386e` 的 [Windows CI 36855278836](https://github.com/uniquenesssta/mdr/actions/runs/36855278836) 七个 job 全部成功，具备 13.7 准入条件。唯一分支 `agent/r13-stage`；前置与回退代码基线 R13.5 `fd9c35d92d81c2cf3cd059c7e41797bfc37a962a`，Windows CI 36853092080 七个 job 全部成功。

## 入口规则与统一决策

本项统一浏览器规则的实现位置，不统一不同入口的数值。保留已验收的 R13.1 行为：

| 入口 | 类型判定 | 硬限制 | 确认 |
| --- | --- | --- | --- |
| 浏览器 drop | 文本扩展名优先，其余按大小写敏感 image/ MIME 前缀 | 大于 5 MiB 拒绝 | 无 |
| 图片对话框 File | 仅 image/ MIME 前缀，包括 BMP；不依赖文件名 | 大于 5 MiB 拒绝 | 大于 2 MiB 且不超限才确认 |
| Windows 图片路径 / readImage | 既有 png/jpg/jpeg/gif/webp/svg 扩展名 | Rust readLocalImage 保留 20 MiB | 无 |
| Rust read_dropped_file 图片分支 | Rust File Kind | Rust Image Reader 保留 5 MiB | 无 |

等于阈值允许；对话框拒绝确认不读取、不插入。URL 输入没有 File 字节元数据，不套用本地文件大小判断。浏览器 MIME 是兼容性分类，不代表内容安全认证；现有渲染边界保持。File 的 type/size 使用既有元数据语义，不读取内容、不新增格式解码。

## 实际变更与所有权

新增 `images/image-policy.js`，公开纯函数 `isAllowedImageMime(type)`、`assessBrowserImage(file, { source })`，返回冻结的 allowed/reason/requiresConfirmation。source 仅支持 drop/dialog，误传原生来源明确拒绝，防止把桌面 20 MiB 入口误当作浏览器 5 MiB。模块没有监听器、可变状态、I/O 或销毁资源。

File Type Classifier 复用唯一 MIME 判断，仍在 drop 中优先分类文本且不读取 size；Image Dialog View 从公共 Import 入口取得策略，再负责现有提示、确认和读取。经典 events 通过现有 scoped Drop Import port 的 assessImage 获取同一 drop 策略；不增加新桥或全局对象，该方法遵守原端口终态保护。13.13/13.14 与现有桥一起删除。旧 events/dialog 中大小比较与分类器中的 MIME 前缀判断已移除，不保留第二份浏览器权威。

Rust Image Reader 继续拥有原生实际文件字节限制；本项不在 JS 复制原生数值用于运行时决策。图片读取/代次/取消完善仍归 13.7，Markdown 构造归 13.8；13.4 已有晚到、失败和 abort 保护原样保留。对话框已有晚到读取缺口仍移交 13.7，未在本项宣称关闭。

## 验证与限制

- 新增独立规则测试：image/* 兼容、大小写/非法 MIME、零字节、2/5 MiB 前后边界、20 MiB 不误接受、确认与拒绝互斥、冻结结果、错误来源、无内容读取、文本优先与对话框差异。
- 新增现有端口策略一致性及销毁后拒绝调用；静态契约保证生产调用者不再散落大小比较、Rust 5/20 MiB 限制仍存在。
- 保留原完整导入矩阵：实际 events + Drop Import + scoped port 的读取/提示/失败/取消路径，以及真实 Image Dialog View 的确认、拒绝、边界、插入行为。分类器接线断言随职责迁移更新，不删除行为覆盖。
- 生产模块清单追加一个纯策略模块；未新增依赖、模型、持久化格式或 Rust 改动。
- 本地只执行 JS/MJS 语法、JSON、相对引用与差异静态检查，不在 Linux/macOS 跑产品测试或构建。完整行为、架构、浏览器启动、Windows WebView、Rust 和依赖验证交由七组 Windows CI；启动后停止，不轮询。2026-10-01 应收尾请求核对精确提交，确认通过并勾选 13.6。

已用 Mermaid Chart 复核策略调用与 Rust 字节限制边界；没有新增第三方 API。A05/R13-S01、A03 和 A10 原移交保持。
