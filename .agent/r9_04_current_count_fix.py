from pathlib import Path

path = Path('tests/stage-01-handoff.test.mjs')
text = path.read_text(encoding='utf-8')
old = '  assert.equal(moduleFixture.modules.length, 373);'
new = '  assert.equal(moduleFixture.modules.length, 374);'
if text.count(old) != 1:
    raise RuntimeError(f'expected one current package count assertion, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('R9-04 current package module count aligned')
