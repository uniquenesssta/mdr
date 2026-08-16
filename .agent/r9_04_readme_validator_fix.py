from pathlib import Path

path = Path('.agent/r9_04_validate_final.sh')
text = path.read_text(encoding='utf-8')
old = "R9-04 / Stage 9：EditorScrollMapper 已接管编辑器滚动几何，使用 CodeMirror 几何与冻结 DocumentModel 行范围；旧 scroll-sync.js 中 Canvas/textarea 全文度量及重建状态已删除，编辑器偏好变化经 scoped Editor UI port 触发几何刷新；Preview Mapper/Geometry Session/Selection 尚未启动。验证：R9-04 14/14，R9-03 13/13，R9-02 13/13，R9-01 13/13，Stage 8 179/179，Node 178/178，Architecture PASS，Browser contract 10/10，Build PASS，Built-app 29/29×2 PASS，audit 0。"
new = "R9-04 / Stage 9：EditorScrollMapper 接管 CodeMirror 滚动几何，旧 Canvas/textarea 度量删除；偏好经 scoped port 刷新几何；Preview/Geometry/Selection 未启动。验证：R9-04 14/14，R9-03 13/13，R9-02 13/13，R9-01 13/13，Stage 8 179/179，Node 178/178，Architecture/Build PASS，Browser 10/10，Built-app 29/29×2，audit 0。"
if text.count(old) != 1:
    raise SystemExit(f'expected one README record, found {text.count(old)}')
text = text.replace(old, new, 1)
text = text.replace("grep -q 'Browser contract 10/10' README.md", "grep -q 'Browser 10/10' README.md", 1)
text = text.replace("grep -q 'Built-app 29/29×2 PASS' README.md", "grep -q 'Built-app 29/29×2' README.md", 1)
path.write_text(text, encoding='utf-8')
print('R9-04 concise README validator fixed')
