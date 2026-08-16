# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-05 / Stage 9：PreviewScrollMapper接管源码行↔预览Y及缓存/resize；虚拟仅读height index，不读editor；Geometry/Selection未启，行为不变。验证：R9-05 16/16，R9-04 14/14，R9-03/R9-02/R9-01 13/13，Stage 8 179/179，Node 186/186，Architecture/Build PASS，Browser contract 10/10，Built-app 29/29×2 PASS，audit 0。
