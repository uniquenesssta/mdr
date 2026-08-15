# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 8.7：Prefix、Task Checkbox、HR 已拆为独立模块，经 Hybrid Editor 公共入口接入；Task 仅改单个 marker 且单次 1 transaction，Prefix/HR 无交互状态，旧实现已删，8.8 Code Block 未开始。验证：8.7 9/9，Stage 8 72/72，Node 92/92，Architecture/Browser/Build/Built-app PASS，audit 0；接口、持久化、Rust、生产依赖不变。
