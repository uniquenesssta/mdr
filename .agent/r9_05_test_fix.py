from pathlib import Path

path = Path('tests/stage-09-preview-scroll-mapper.test.mjs')
text = path.read_text(encoding='utf-8')
text = text.replace("assert.equal(h.mapper.getContentYForLine(3.5), 200);", "assert.equal(h.mapper.getContentYForLine(3.5), 160);")
text = text.replace("assert.ok(Math.abs(h.mapper.getLineForContentY(150) - 3.75) < 1e-9);", "assert.ok(Math.abs(h.mapper.getLineForContentY(150) - 3.125) < 1e-9);")
path.write_text(text, encoding='utf-8')

path = Path('tests/architecture/stage-09-editor-scroll-mapper.test.mjs')
text = path.read_text(encoding='utf-8')
old = "assert.match(main, /createEditorScrollMapper, createScrollSyncController \\} from ['\"]\\.\\/features\\/sync\\/index\\.js['\"]/);"
new = "assert.match(main, /createEditorScrollMapper, createPreviewScrollMapper, createScrollSyncController \\} from ['\"]\\.\\/features\\/sync\\/index\\.js['\"]/);"
if text.count(old) != 1:
    raise RuntimeError(f'R9-04 Sync import assertion: expected one match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
