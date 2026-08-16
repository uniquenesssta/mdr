from pathlib import Path

path = Path('tests/stage-09-editor-scroll-mapper.test.mjs')
text = path.read_text(encoding='utf-8')
old = "    assert.equal(h.mapper.getContentYForLine(99), 399.9);"
new = "    assert.ok(Math.abs(h.mapper.getContentYForLine(99) - 399.9) < 1e-9);"
if text.count(old) != 1:
    raise RuntimeError(f'expected one floating-point assertion, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('R9-04 numeric test assertion fixed')
