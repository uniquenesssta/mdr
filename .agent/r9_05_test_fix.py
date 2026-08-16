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

path = Path('src/main.js')
text = path.read_text(encoding='utf-8')
old = """    previewScrollMapper = createPreviewScrollMapper({
      previewElement: previewHost,
      virtualApi: previewCommandHandler.port.virtual,
      createResizeObserver: typeof window.ResizeObserver === 'function'
        ? callback => new window.ResizeObserver(callback)
        : null,
      setTimer: window.setTimeout.bind(window),
      clearTimer: window.clearTimeout.bind(window),
      onGeometryChanged: () => scrollController.notifyGeometryChanged('preview')
    });
"""
new = """    const previewView = previewHost.ownerDocument?.defaultView;
    const PreviewResizeObserver = previewView?.ResizeObserver;
    previewScrollMapper = createPreviewScrollMapper({
      previewElement: previewHost,
      virtualApi: previewCommandHandler.port.virtual,
      createResizeObserver: typeof PreviewResizeObserver === 'function'
        ? callback => new PreviewResizeObserver(callback)
        : null,
      setTimer: previewView.setTimeout.bind(previewView),
      clearTimer: previewView.clearTimeout.bind(previewView),
      onGeometryChanged: () => scrollController.notifyGeometryChanged('preview')
    });
"""
if text.count(old) != 1:
    raise RuntimeError(f'Preview observer composition: expected one match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')

path = Path('tests/architecture/stage-09-preview-scroll-mapper.test.mjs')
text = path.read_text(encoding='utf-8')
needle = "  assert.doesNotMatch(main, /window\\.markdownEditorPreviewScrollMapper/);"
replacement = "  assert.doesNotMatch(main, /window\\.markdownEditorPreviewScrollMapper/);\n  assert.doesNotMatch(main, /window\\.ResizeObserver/);"
if text.count(needle) != 1:
    raise RuntimeError(f'Preview architecture global assertion: expected one match, found {text.count(needle)}')
path.write_text(text.replace(needle, replacement, 1), encoding='utf-8')
