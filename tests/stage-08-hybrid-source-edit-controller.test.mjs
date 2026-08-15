import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HYBRID_COMPONENT_MODES,
  HybridComponentSession,
  createHybridSourceEditController
} from '../src/features/hybrid-editor/index.js';

function createHarness(options = {}) {
  const calls = [];
  const frames = [];
  const port = {
    documentLength: options.documentLength ?? 200,
    selection: { anchor: 0, head: 0 },
    position: options.position ?? null,
    getDocumentLength() { return this.documentLength; },
    getScrollViewportMetrics() { return { top: 100, height: 500, clientHeight: 480 }; },
    markProgrammaticScroll(surface, durationMs) { calls.push(['mark', surface, durationMs]); },
    focus() { calls.push(['focus']); },
    revealSourceRange(request) { calls.push(['reveal', request]); },
    inspectUpdate(update, range) {
      return {
        range: update.mappedRange || range,
        selectionSet: Boolean(update.selectionSet),
        selection: update.selection || this.selection
      };
    },
    positionAtCoordinates(coords) { calls.push(['pos', coords]); return this.position; },
    setSelection(position) { calls.push(['selection', position]); this.selection = { anchor: position, head: position }; },
    blur() { calls.push(['blur']); }
  };
  const transitions = [];
  const session = new HybridComponentSession({
    now: () => 10,
    onTransition: transition => transitions.push(transition)
  });
  const closes = [];
  const controller = createHybridSourceEditController({
    editorPort: port,
    session,
    requestFrame: callback => { frames.push(callback); return frames.length; },
    scheduleGeometry: reason => calls.push(['geometry', reason]),
    recordClose: details => closes.push(details)
  });
  return { calls, closes, controller, frames, port, session, transitions };
}

test('Atomic 8.4 opens SOURCE through the editor port with frozen range, selection and scroll margin semantics', () => {
  const h = createHarness();
  const range = h.controller.open({
    componentType: 'code', from: 20, to: 80, editFrom: 30, editTo: 70, preferredPosition: 35
  }, { anchorRect: { top: 220 } });
  assert.deepEqual(range, { from: 20, to: 80, componentType: 'code', componentKey: 'code:20' });
  assert.equal(h.session.getCurrent().mode, HYBRID_COMPONENT_MODES.SOURCE);
  assert.equal(h.session.getCurrent().reason, 'source-open');
  assert.deepEqual(h.calls.slice(0, 3), [
    ['mark', 'editor', 420],
    ['focus'],
    ['reveal', {
      sourceFrom: 20, sourceTo: 80, selectionFrom: 30, selectionTo: 70, position: 35, yMargin: 120
    }]
  ]);
  assert.equal(h.calls.some(call => call[0] === 'geometry'), false);
  h.frames.shift()();
  assert.deepEqual(h.calls.at(-1), ['geometry', 'source-opened']);
});

test('Atomic 8.4 maps the active range and closes SOURCE when selection leaves it', () => {
  const h = createHarness();
  h.controller.open({ componentType: 'math', from: 10, to: 30 });
  h.controller.handleEditorUpdate({
    mappedRange: { from: 12, to: 35, componentType: 'math', componentKey: 'math:10' },
    selectionSet: true,
    selection: { anchor: 50, head: 50 }
  });
  assert.equal(h.controller.getActiveRange(), null);
  assert.equal(h.session.get('math:10').mode, HYBRID_COMPONENT_MODES.PRESENTED);
  assert.deepEqual(h.closes.at(-1), {
    trigger: 'selection-left', sourceFrom: 12, sourceTo: 35
  });
});

test('Atomic 8.4 preserves immediate outside-pointer close ordering and fallback selection', () => {
  const h = createHarness({ documentLength: 100, position: 25 });
  h.controller.open({ componentType: 'table', from: 20, to: 40 });
  h.calls.length = 0;
  const ordering = [];
  const originalSetSelection = h.port.setSelection.bind(h.port);
  h.port.setSelection = position => { ordering.push('selection'); originalSetSelection(position); };
  const originalClose = h.session.close.bind(h.session);
  h.session.close = (...args) => { ordering.push('close'); return originalClose(...args); };
  const handled = h.controller.closeFromPointer({
    button: 0,
    x: 10,
    y: 20,
    targetIsEditorLine: false,
    preventDefault: () => ordering.push('prevent'),
    stopPropagation: () => ordering.push('stop')
  });
  assert.equal(handled, true);
  assert.deepEqual(ordering, ['close', 'prevent', 'stop', 'selection']);
  assert.deepEqual(h.calls.find(call => call[0] === 'selection'), ['selection', 41]);
  assert.equal(h.closes.at(-1).immediate, true);
});

test('Atomic 8.4 keeps an inside-source editor-line pointer open and blurs only for a full-document source range', () => {
  const inside = createHarness({ documentLength: 100, position: 25 });
  inside.controller.open({ from: 20, to: 40 });
  assert.equal(inside.controller.closeFromPointer({ button: 0, targetIsEditorLine: true }), false);
  assert.ok(inside.controller.getActiveRange());

  const full = createHarness({ documentLength: 40, position: null });
  full.controller.open({ from: 0, to: 40 });
  full.calls.length = 0;
  assert.equal(full.controller.closeFromPointer({ button: 0, targetIsEditorLine: false }), true);
  assert.deepEqual(full.calls.find(call => call[0] === 'blur'), ['blur']);
});

test('Atomic 8.4 invalidates stale deferred geometry and destroy is terminal', () => {
  const h = createHarness();
  h.controller.open({ from: 10, to: 20 });
  const staleOpen = h.frames.shift();
  h.controller.close('test-close');
  staleOpen();
  assert.equal(h.calls.some(call => call[0] === 'geometry'), false);

  h.controller.open({ from: 30, to: 40 });
  const staleSecondOpen = h.frames.shift();
  h.controller.destroy();
  staleSecondOpen();
  assert.equal(h.calls.some(call => call[0] === 'geometry'), false);
  assert.equal(h.controller.getActiveRange(), null);
  assert.throws(() => h.controller.open({ from: 0, to: 1 }), /destroyed/);
  h.controller.destroy();
});

test('Atomic 8.4 Session supersede clears the source range before another interactive component becomes current', () => {
  const h = createHarness();
  h.controller.open({ componentType: 'code', from: 10, to: 20 });
  h.session.transition({
    key: 'table:50', type: 'table', from: 50, mode: HYBRID_COMPONENT_MODES.DIRECT, reason: 'doubleclick'
  });
  assert.equal(h.controller.getActiveRange(), null);
  assert.equal(h.session.getCurrent().key, 'table:50');
  assert.equal(h.closes.at(-1).trigger, 'superseded');
});
