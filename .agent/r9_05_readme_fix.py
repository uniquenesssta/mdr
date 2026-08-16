from pathlib import Path

path = Path('.agent/r9_05_validate.sh')
text = path.read_text(encoding='utf-8')
old = "R9-05 / Stage 9：PreviewScrollMapper 已接管源码行↔预览 content Y 映射、anchor/metric cache 与 preview body 尺寸失效监听；虚拟模式仅消费 Preview Controller virtual height index，经典 scroll-sync 不再持有预览映射状态且 Preview Mapper 不查询 editor 内部；Geometry Session/Selection 尚未启动。验证：R9-05 16/16，R9-04 14/14，R9-03 13/13，R9-02 13/13，R9-01 13/13，Stage 8 179/179，Node ${node_tests}/${node_pass}，Architecture PASS，Browser contract 10/10，Build PASS，Built-app 29/29×2 PASS，audit 0。"
new = "R9-05 / Stage 9：PreviewScrollMapper接管源码行↔预览Y及缓存/resize；虚拟仅读height index，不读editor；Geometry/Selection未启，行为不变。验证：R9-05 16/16，R9-04 14/14，R9-03/R9-02/R9-01 13/13，Stage 8 179/179，Node ${node_tests}/${node_pass}，Architecture/Build PASS，Browser contract 10/10，Built-app 29/29×2 PASS，audit 0。"
if text.count(old) != 1:
    raise RuntimeError(f'R9-05 README record: expected one match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
