# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

Atomic 7.14 旧预览管线删除完成：PreviewController + RenderEngine + PreviewCommandPort 成为唯一预览主链，旧 preview/Worker/Virtual/rendering/runtime 路径已移除，无双 pipeline。验证：7.14 8/8、Stage 7 167/167、Node 48/48、browser 10/10、built-app 29/29、build/architecture/Frozen/audit PASS。持久化/Rust/依赖未变。
