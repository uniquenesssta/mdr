# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 7.8 DOM Renderers 完成：body/block、task、code、math、Mermaid 拆分并统一经 PreviewRendererPort/共享 presentation；renderer 不拥有布局/同步/virtual-window。验证：7.8 25/25、Stage 7 87/87、Node 48/48、browser 10/10、built-app 29/29、build/architecture/Frozen/audit PASS。接口/持久化/Rust/依赖未变；7.9 未开始。
