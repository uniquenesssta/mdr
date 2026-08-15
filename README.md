# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 8.11：Math 已拆为独立 Inline/Block Widget，并复用既有 Preview Math presentation API；$ / \( 与 $$ / \[ 分隔符语义保持不变，源码范围与显式销毁路径有测试，旧 Math 权威实现已删，8.12 Mermaid 未开始。验证：8.11 12/12，Stage 8 127/127，Node 123/123，Architecture/Browser/Build/Built-app PASS，audit 0；接口、Rust、冻结模型、生产依赖不变。
