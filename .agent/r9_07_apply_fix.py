from pathlib import Path

path = Path('.agent/r9_07_apply.py')
text = path.read_text(encoding='utf-8')
old = 'without owning editor state, DOM listeners, mapping, highlighting or synchronization policy.'
new = 'without owning editor state, DOM listeners, projection or synchronization policy.'
if text.count(old) != 1:
    raise RuntimeError(f'expected one EditorSelectionReader responsibility marker, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
