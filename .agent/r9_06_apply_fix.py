from pathlib import Path

path = Path('.agent/r9_06_apply.py')
text = path.read_text(encoding='utf-8')
old = '''controller = replace_once(controller, "    this.pendingGeometryResync = false;\\n", '', 'controller pending geometry state')'''
new = '''needle = "    this.pendingGeometryResync = false;\\n"
if needle not in controller:
    raise RuntimeError('controller pending geometry state: constructor marker missing')
controller = controller.replace(needle, '', 1)'''
if text.count(old) != 1:
    raise RuntimeError(f'apply-script fix expected one controller source match, found {text.count(old)}')
text = text.replace(old, new, 1)
old_gate = r'|sourceSide\s*=|sourceReason\s*=/'
new_gate = r'|this\.sourceSide\s*=|this\.sourceReason\s*=/'
if text.count(old_gate) != 1:
    raise RuntimeError(f'apply-script fix expected one ownership-gate match, found {text.count(old_gate)}')
text = text.replace(old_gate, new_gate, 1)
path.write_text(text, encoding='utf-8')
