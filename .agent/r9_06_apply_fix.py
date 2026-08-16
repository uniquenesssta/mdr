from pathlib import Path

path = Path('.agent/r9_06_apply.py')
text = path.read_text(encoding='utf-8')
old = '''controller = replace_once(controller, "    this.pendingGeometryResync = false;\\n", '', 'controller pending geometry state')'''
new = '''needle = "    this.pendingGeometryResync = false;\\n"
if needle not in controller:
    raise RuntimeError('controller pending geometry state: constructor marker missing')
controller = controller.replace(needle, '', 1)'''
if text.count(old) != 1:
    raise RuntimeError(f'apply-script fix expected one source match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
