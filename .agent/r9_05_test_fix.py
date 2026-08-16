from pathlib import Path
path = Path('tests/stage-09-preview-scroll-mapper.test.mjs')
text = path.read_text(encoding='utf-8')
text = text.replace("assert.equal(h.mapper.getContentYForLine(3.5), 200);", "assert.equal(h.mapper.getContentYForLine(3.5), 160);")
text = text.replace("assert.ok(Math.abs(h.mapper.getLineForContentY(150) - 3.75) < 1e-9);", "assert.ok(Math.abs(h.mapper.getLineForContentY(150) - 3.125) < 1e-9);")
path.write_text(text, encoding='utf-8')
