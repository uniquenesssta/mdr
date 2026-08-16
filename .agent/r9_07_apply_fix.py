from pathlib import Path

apply_path = Path('.agent/r9_07_apply.py')
apply_text = apply_path.read_text(encoding='utf-8')
old = 'without owning editor state, DOM listeners, mapping, highlighting or synchronization policy.'
new = 'without owning editor state, DOM listeners, projection or synchronization policy.'
if apply_text.count(old) != 1:
    raise RuntimeError(f'expected one EditorSelectionReader responsibility marker, found {apply_text.count(old)}')
apply_path.write_text(apply_text.replace(old, new, 1), encoding='utf-8')

validate_path = Path('.agent/r9_07_validate.sh')
validate_text = validate_path.read_text(encoding='utf-8')
old_readme = '''R9-07 / Stage 9：EditorSelectionReader 与 PreviewSelectionReader 已接管最终编辑器/预览选区边界读取，Preview Reader 独立拥有 selectionchange 与指针选区稳定等待；旧 SelectionSyncController/经典映射仅消费 Reader 快照，不再直接读取 selectionStart/end 或 window.getSelection；Feedback Guard、Highlight Session、Retry Scheduler 与 Selection Controller 正式迁移尚未启动，既有用户行为保持。验证：R9-07 15/15，R9-06 14/14，R9-05 16/16，R9-04 14/14，R9-03~R9-01 13/13，Stage 8 179/179，Node ${node_tests}/${node_pass}，Architecture/Build PASS，Browser contract 10/10，Built-app 29/29×2 PASS，audit 0。'''
new_readme = '''R9-07 / Stage 9：新增两个 Selection Reader，接管最终选区读取与预览稳定等待；旧层仅消费快照，frozen mapping 未改，R9-08+ 未启动，行为不变。验证：R9-07 15/15；R9-06 14/14；R9-05 16/16；R9-04 14/14；R9-03~R9-01 13/13；Stage 8 179/179；Node ${node_tests}/${node_pass}；Architecture/Build PASS；Browser contract 10/10；Built-app 29/29×2 PASS；audit 0。'''
if validate_text.count(old_readme) != 1:
    raise RuntimeError(f'expected one README validation template, found {validate_text.count(old_readme)}')
validate_path.write_text(validate_text.replace(old_readme, new_readme, 1), encoding='utf-8')
