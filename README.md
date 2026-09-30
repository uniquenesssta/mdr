# Markdown Editor

Stage 12：`agent/r12-stage`；历史见 [docs/README.md](docs/README.md)。

## Change Log

- 2026-09-30：R12-23 `89e8d57` Windows 6/6、递归 Node 1482/1482、Rust 268/268、浏览器 11/11+29/29、官方公告/TLS/WebView 通过，A10 当前处置验收；开始 R12-24，复用完整 Windows 回归并增加同运行精确证据收官判定，A04/A05 按条件移交但未修复，待 CI。未改生产源码、模型/格式、依赖与命令。[23 验收](docs/R12-23-DETAILS.md) · [24 详情](docs/R12-24-DETAILS.md)。

- 2026-09-30：R12-22 `ccaf7af` Windows CI 5/5、Node 1474/1474、Rust 268/268、浏览器 11/11+29/29 通过，原生安全及两布局合法内容证据已核对，A03 当前渲染风险关闭；开始 R12-23，定向更新 rustls/time/quick-xml/quinn-proto 依赖链，新增官方公告验证与真实 TLS 1.3 回归，待 Windows CI。[22 验收](docs/R12-22-DETAILS.md) · [23 详情](docs/R12-23-DETAILS.md)。

- 2026-09-30：R12-22 整改 CI `36708920012` 为 3/5 job 通过，Node 1474/1474、Rust 268/268、built-app 29/29；四面攻击样例通过，第五面挂载与浏览器模块解析中断。已修正契约测试 DOMPurify 映射及虚拟工厂探针容器所有权，新增浏览器行为回归；待 Windows 重验，A03 保持开放。[详情](docs/R12-22-DETAILS.md)。

- 2026-09-30：R12-22 基线 CI 5/5、全仓 Node 1472/1472、Rust 268/268 通过，R18-N01 已复验；依据真实 WebView 风险接入公共 HTML 净化、CSP 和五面安全/两布局合法内容硬性回归，整改待 Windows CI，A03 保持开放。[详情](docs/R12-22-DETAILS.md)。

- 2026-09-30：R12-22 修正 job env 中不可用的 runner 上下文，日志目录由运行步骤写入 GITHUB_ENV；actionlint 1.7.12 语义检查通过，新增回归；首轮未启动任何测试，修正提交待 Windows CI。[详情](docs/R12-22-DETAILS.md)。
- 2026-09-30：R12-22 启动真实 Windows WebView HTML 基线探测，覆盖 Preview 全量/块与 Hybrid Widget、无害事件及测试自有文件 IPC；已修正 Preview 循环依赖，待 CI；A03 保持开放。[详情](docs/R12-22-DETAILS.md)。
- 2026-09-30：R12-21 修正提交 `cde35b8` 已通过 Windows 专项验收：安全写入 18/18、Rust 268/268、Clippy 通过；累计 Node 1466/1467，唯一既有 Preview 循环依赖归 R12-22。[详情](docs/R12-21-DETAILS.md)。
- 2026-09-30：R12-21 文本/二进制共用同目录临时文件、同步与 Windows 安全替换；新增 18 项故障回归，保留原命令及字节契约；Windows 专项已验收。[详情](docs/R12-21-DETAILS.md)。
- 2026-09-18：R12-08 已验收，09～13 已完成；[详情](docs/R12-08-DETAILS.md)。
- 2026-09-29：R12-14/A01、16 已专项验收；[详情](docs/R12-16-DETAILS.md)。
- 2026-09-30：R12-17 命令迁移，19 项注册不变；Windows 专项通过，40 项遗留不变。[详情](docs/R12-17-DETAILS.md)。
- 2026-09-29：R12-18 修正审计门禁并补齐清单，Windows 审计专项已验收；真实 Preview 循环依赖仍保留失败。[详情](docs/R12-18-DETAILS.md)。
- 2026-09-30：R12-19 修复保存失败传播、dirty 提交边界及 Rust 缓存失效；Windows 专项已验收，Rust 250/250；唯一既有 Preview 循环依赖仍待 R12-22。[详情](docs/R12-19-DETAILS.md)。
- 2026-09-30：R12-20 复核现行脱敏链路，补充错误原因链、异常属性及数组 JSONL 回读断言；Windows 专项已验收；唯一既有 Preview 循环依赖仍归 R12-22。[详情](docs/R12-20-DETAILS.md)。
