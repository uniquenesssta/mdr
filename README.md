# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 8.10：Image 已拆为 source resolver、cache、error/retry view 与 Widget 生命周期；异步加载按组件 version 拒绝过时结果，旧 image-source/Image Widget 权威实现已删，8.11 Math 未开始。验证：8.10 13/13，Stage 8 115/115，Node 117/117，Architecture/Browser/Build/Built-app PASS，audit 0；接口、Rust、冻结模型、生产依赖不变。
