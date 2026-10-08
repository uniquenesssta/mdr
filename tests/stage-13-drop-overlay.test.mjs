import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createDropOverlayView, createDropImportController } from '../src/features/import/index.js';

function element() {
  const classes = new Set(['drop-overlay', 'show']); const writes = [];
  return { classes, writes, classList: {
    add(name) { writes.push(['add', name]); classes.add(name); },
    remove(name) { writes.push(['remove', name]); classes.delete(name); }
  } };
}

test('Drop Overlay renders only controller visibility and preserves unrelated classes', () => {
  const node = element(); const view = createDropOverlayView({ element: node });
  assert.equal(Object.isFrozen(view), true); assert.equal(node.classes.has('show'), false);
  view.setVisible(true); assert.equal(node.classes.has('show'), true);
  view.setVisible(false); assert.equal(node.classes.has('show'), false);
  assert.equal(node.classes.has('drop-overlay'), true);
  view.setVisible(true); view.destroy(); assert.equal(node.classes.has('show'), false);
  const writes = node.writes.length;
  view.setVisible(true); view.setVisible(false); view.destroy();
  assert.equal(node.writes.length, writes, 'terminal view never touches its released DOM reference');
});

test('missing optional overlay remains supported; malformed elements are rejected', () => {
  const view = createDropOverlayView(); view.setVisible(true); view.destroy(); view.setVisible(true);
  for (const node of [{}, { classList: {} }, { classList: { add() {} } }]) {
    assert.throws(() => createDropOverlayView({ element: node }), /requires an element with classList/);
  }
});

test('controller owns counters; overlay teardown before late native callbacks cannot show it again', async () => {
  const node = element(), view = createDropOverlayView({ element: node });
  const handlers = new Map(); let native, disposed = 0;
  const controller = createDropImportController({
    target: { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) },
    nativeDrop: true, nativeFiles: true,
    subscribeNative: handler => { native = handler; return () => disposed++; }
  });
  controller.start({
    setOverlayVisible: view.setVisible,
    openBrowserText() {}, openBrowserImage() {}, openNativeText() {}, openNativeImage() {}, unsupported() {}, onError(error) { throw error; }
  });
  handlers.get('dragenter')({ preventDefault() {} }); handlers.get('dragenter')({ preventDefault() {} });
  handlers.get('dragleave')(); assert.equal(node.classes.has('show'), true);
  handlers.get('dragleave')(); assert.equal(node.classes.has('show'), false);
  await native({ type: 'over' }); assert.equal(node.classes.has('show'), true);
  view.destroy(); const writes = node.writes.length;
  await native({ type: 'over' }); assert.equal(node.classes.has('show'), false);
  await controller.destroy(); await native({ type: 'over' });
  assert.equal(node.writes.length, writes); assert.equal(handlers.size, 0); assert.equal(disposed, 1);
});

test('production composes the public view before owned Import callbacks and destroys it on both exit paths', async () => {
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
  const [main, events, view] = await Promise.all([read('src/main.js'), read('public/app/events.js'), read('src/features/import/files/drop-overlay-view.js')]);
  assert.match(main, /createDropOverlayView\(\{ element: document\.getElementById\('drop-overlay'\) \}\)/);
  assert.match(main, /dropImportController\.start\(\{[\s\S]*?setOverlayVisible: dropOverlayView\.setVisible/);
  assert.ok(main.indexOf('const dropOverlayView = ') < main.indexOf('dropImportController.start({'));
  assert.match(main, /openBrowserText: \(file, request\) => importDocumentController\.openBrowserFile\(file, request\)/);
  assert.equal(main.match(/dropOverlayView\.destroy\(\)/g).length, 2);
  assert.doesNotMatch(events, /dropOverlay|drop-overlay|setOverlayVisible/);
  assert.doesNotMatch(view, /addEventListener|FileReader|readText|readImage|dragCounter|createDropImportController/);
});
