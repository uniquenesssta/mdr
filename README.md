# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 8.12：Mermaid 已拆为 Widget、render state、actions；源码/主题/位置共同决定渲染身份并复用既有 Preview Mermaid presentation，旧异步结果在 DOM 发布前丢弃，旧 Mermaid 权威实现已删，8.13 HTML 未开始。验证：8.12 13/13，Stage 8 140/140，Node 130/130，Architecture/Browser/Build/Built-app PASS，audit 0；接口、Rust、冻结模型、Preview 算法、生产依赖不变。