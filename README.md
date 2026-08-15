# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 8.9：Table 已拆为 view、cell editor、navigation、writeback、Widget 生命周期；冻结 table model 不改，四种键盘导航、提交/取消/销毁有测试，旧实现已删，8.10 未开始。验证：8.9 15/15，Stage 8 102/102，Node 110/110，Architecture/Browser/Build/Built-app PASS，audit 0；接口、Rust、生产依赖不变。
