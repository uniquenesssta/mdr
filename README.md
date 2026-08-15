# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 8.6：Shared Widget UI 已抽离按钮、工具栏、焦点策略与源码动作四个无组件类型分支的可复用原语，legacy widgets 仅经 Hybrid Editor 公共入口消费；组件策略仍留在各组件实现，8.7 未开始。验证：8.6 10/10，Stage 8 63/63，Node 88/88，Architecture/Browser/Build/Built-app PASS，audit 0。接口、持久化、Rust、生产依赖不变。
