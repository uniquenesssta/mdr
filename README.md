# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 8.13：HTML 已拆为 Widget/View，保留原始 template.innerHTML 与 SOURCE 语义，不新增 sanitizer；旧 widgets.js 已删并补齐销毁。验证：8.13 11/11，Stage 8 151/151，Node 135/135，Architecture/Browser/Build/Built-app PASS，audit 0；接口、Rust、冻结模型、生产依赖不变。
