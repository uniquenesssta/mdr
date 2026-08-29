import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { history } from '@codemirror/commands';
import { createCodeMirrorAdapter } from '../../../src/features/editor/index.js';

class FakeScrollDom {
  constructor() {
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 800;
    this.scrollWidth = 640;
    this.clientHeight = 120;
    this.clientWidth = 320;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type) {
    for (const listener of this.listeners.get(type) || []) listener({ type, target: this });
  }

  scrollTo(optionsOrX, y) {
    if (typeof optionsOrX === 'object') {
      if (Number.isFinite(Number(optionsOrX.top))) this.scrollTop = Number(optionsOrX.top);
      if (Number.isFinite(Number(optionsOrX.left))) this.scrollLeft = Number(optionsOrX.left);
    } else {
      this.scrollLeft = Number(optionsOrX) || 0;
      this.scrollTop = Number(y) || 0;
    }
    this.emit('scroll');
  }

  scrollBy(optionsOrX, y) {
    if (typeof optionsOrX === 'object') {
      this.scrollTop += Number(optionsOrX.top) || 0;
      this.scrollLeft += Number(optionsOrX.left) || 0;
    } else {
      this.scrollLeft += Number(optionsOrX) || 0;
      this.scrollTop += Number(y) || 0;
    }
    this.emit('scroll');
  }

  getBoundingClientRect() {
    return { top: 10, bottom: 130, left: 20, right: 340, width: 320, height: 120 };
  }
}

class FakeContentDom {
  constructor() {
    this.attributes = new Map();
    this.blurred = false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  blur() {
    this.blurred = true;
  }
}

function createFakeViewFactory(holder = {}) {
  return ({ state, notifyUpdate }) => {
    const scrollDOM = new FakeScrollDom();
    const contentDOM = new FakeContentDom();
    const fake = {
      state,
      viewport: { from: 0, to: state.doc.length },
      defaultLineHeight: 20,
      scrollDOM,
      contentDOM,
      hasFocus: false,
      destroyed: false,
      dispatch: null,
      setState(nextState) {
        this.state = nextState;
        this.viewport = { from: 0, to: nextState.doc.length };
      },
      focus() {
        this.hasFocus = true;
      },
      destroy() {
        this.destroyed = true;
      },
      lineBlockAt(position) {
        const line = this.state.doc.lineAt(Math.max(0, Math.min(position, this.state.doc.length)));
        return { from: line.from, top: (line.number - 1) * 20, height: 20 };
      },
      lineBlockAtHeight(height) {
        const lineNumber = Math.max(1, Math.min(this.state.doc.lines, Math.floor(Math.max(0, height) / 20) + 1));
        const line = this.state.doc.line(lineNumber);
        return { from: line.from, top: (line.number - 1) * 20, height: 20 };
      },
      coordsAtPos(position) {
        const line = this.state.doc.lineAt(Math.max(0, Math.min(position, this.state.doc.length)));
        const column = Math.max(0, position - line.from);
        const top = 10 + (line.number - 1) * 20;
        const left = 20 + column * 8;
        return { top, bottom: top + 20, left, right: left + 1, width: 1, height: 20 };
      }
    };
    fake.dispatch = specification => {
      const startState = fake.state;
      const transaction = specification?.startState && specification?.state
        ? specification
        : fake.state.update(specification);
      fake.state = transaction.state;
      fake.viewport = { from: 0, to: fake.state.doc.length };
      notifyUpdate({
        view: fake,
        startState,
        state: fake.state,
        docChanged: transaction.docChanged,
        selectionSet: !startState.selection.eq(fake.state.selection),
        focusChanged: false,
        viewportChanged: false,
        changes: transaction.changes
      });
    };
    holder.view = fake;
    return fake;
  };
}

function createAdapter(options = {}) {
  const holder = {};
  const result = createCodeMirrorAdapter({
    parent: {},
    initialValue: options.initialValue ?? 'alpha\nbeta',
    extensions: options.extensions || [],
    viewFactory: createFakeViewFactory(holder),
    reportError: options.reportError || (() => {}),
    markProgrammaticScroll: options.markProgrammaticScroll || (() => {}),
    suspendScrollSync: options.suspendScrollSync || (() => {})
  });
  return { ...result, holder };
}

test('CodeMirror adapter owns text transactions and exposes neutral immutable update snapshots', () => {
  const { api } = createAdapter();
  const updates = [];
  api.subscribe(update => updates.push(update));

  assert.equal(api.getText(), 'alpha\nbeta');
  assert.equal(api.getTextLength(), 10);
  assert.equal(api.getLineCount(), 2);
  assert.equal(api.sliceText(0, 5), 'alpha');
  assert.equal(api.applyTransaction({
    changes: { from: 0, to: 5, insert: 'omega' },
    selection: { anchor: 5 }
  }), true);

  assert.equal(api.getText(), 'omega\nbeta');
  assert.deepEqual(updates[0].changes, [{ from: 0, to: 5, insert: 'omega', removed: 'alpha' }]);
  assert.equal(updates[0].length, 10);
  assert.equal(Object.isFrozen(updates[0]), true);
  assert.equal(Object.isFrozen(updates[0].changes), true);
  for (const forbidden of ['view', 'state', 'scrollDOM', 'contentDOM']) {
    assert.equal(Object.hasOwn(api, forbidden), false, `public adapter must not expose ${forbidden}`);
  }
});

test('selection and replacement operations preserve textarea-compatible range semantics', () => {
  const { api } = createAdapter({ initialValue: 'abcdef' });
  api.setSelection(1, 4);
  assert.deepEqual(api.getSelection(), {
    anchor: 1,
    head: 4,
    start: 1,
    end: 4,
    direction: 'forward'
  });

  api.replaceRange('XY', 2, 4, 'select');
  assert.equal(api.getText(), 'abXYef');
  assert.deepEqual(api.getSelection(), {
    anchor: 2,
    head: 4,
    start: 2,
    end: 4,
    direction: 'forward'
  });
  assert.equal(api.findText('XY')?.from, 2);
  assert.equal(api.replaceAllText('XY', 'Z'), 1);
  assert.equal(api.getText(), 'abZef');
});

test('focus, scroll, geometry and scroll subscriptions stay behind the adapter surface', () => {
  const marked = [];
  const suspended = [];
  const { api, holder } = createAdapter({
    markProgrammaticScroll: duration => marked.push(duration),
    suspendScrollSync: duration => suspended.push(duration)
  });
  let scrollEvents = 0;
  api.subscribeScroll(() => { scrollEvents += 1; });

  api.focus({ preventScroll: true });
  assert.equal(api.hasFocus(), true);
  api.setReadOnly(true);
  assert.equal(holder.view.contentDOM.attributes.get('contenteditable'), 'false');
  api.scrollTo({ top: 80, behavior: 'smooth' });
  assert.equal(api.getScrollMetrics().top, 80);
  assert.equal(scrollEvents, 1);
  assert.equal(api.getDefaultLineHeight(), 20);
  assert.equal(api.getHeightForLine(2), 20);
  assert.equal(api.getLineAtHeight(21) >= 2, true);
  assert.equal(api.getPositionCoordinates(0)?.top, 10);
  assert.equal(api.getScrollViewportRect()?.height, 120);
  api.scrollPositionIntoView(2, 'smooth', 0.5);
  assert.equal(marked.includes(620), true);
  assert.equal(suspended.includes(520), true);
  api.blur();
  assert.equal(holder.view.contentDOM.blurred, true);
});

test('history commands are owned by the adapter without exposing command internals', () => {
  const { api } = createAdapter({ initialValue: 'a', extensions: [history()] });
  api.applyTransaction({ changes: { from: 1, to: 1, insert: 'b' }, selection: { anchor: 2 } });
  api.isolateHistory();
  assert.equal(api.getText(), 'ab');
  assert.equal(api.undo(), true);
  assert.equal(api.getText(), 'a');
  assert.equal(api.redo(), true);
  assert.equal(api.getText(), 'ab');
});

test('adapter listener failures are reported without blocking committed state or sibling listeners', () => {
  const reported = [];
  let delivered = 0;
  const { api } = createAdapter({ reportError: (message, error) => reported.push({ message, error }) });
  api.subscribe(() => { throw new Error('listener boom'); });
  api.subscribe(() => { delivered += 1; });

  api.applyTransaction({ changes: { from: 0, to: 5, insert: 'A' } });
  assert.equal(api.getText().startsWith('A'), true);
  assert.equal(delivered, 1);
  assert.equal(reported.length, 1);
  assert.match(reported[0].message, /update listener failed/i);
});

test('document reset replaces CodeMirror state and clears transaction history without a second reset-history path', () => {
  const { api, integration } = createAdapter({ initialValue: 'old', extensions: [history()] });
  assert.equal(Object.hasOwn(api, 'readView'), false);
  assert.equal(Object.hasOwn(api, 'dispatchEffects'), false);
  api.applyTransaction({ changes: { from: 3, to: 3, insert: '!' }, selection: { anchor: 4 } });
  assert.equal(api.getText(), 'old!');
  assert.equal(integration.resetDocument(['new', '\nvalue'], { selection: 'end', extensions: [history()] }), 9);
  assert.equal(api.getText(), 'new\nvalue');
  assert.equal(api.getSelection().anchor, 9);
  assert.equal(api.undo(), false, 'a new document state must not retain the previous document history');
  assert.equal(Object.hasOwn(integration, 'resetHistory'), false);
});

test('destroy is idempotent, releases the view, and makes later adapter operations terminal', () => {
  const { api, holder } = createAdapter();
  const unsubscribe = api.subscribe(() => {});
  api.destroy();
  api.destroy();
  unsubscribe();
  assert.equal(holder.view.destroyed, true);
  assert.throws(() => api.getText(), /destroyed/i);
  assert.throws(() => api.subscribe(() => {}), /destroyed/i);
});

function walkJavaScript(root) {
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...walkJavaScript(fullPath));
    else if (/\.[cm]?js$/.test(entry.name)) results.push(fullPath);
  }
  return results;
}

test('production integration keeps raw CodeMirror confined to the editor feature and removes classic raw-view access', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
  const virtualEditor = fs.readFileSync(path.join(repositoryRoot, 'src/editor/virtual-editor.js'), 'utf8');
  const scrollSync = fs.readFileSync(path.join(repositoryRoot, 'public/app/scroll-sync.js'), 'utf8');
  const performanceRuntime = fs.readFileSync(path.join(repositoryRoot, 'src/runtime/performance.js'), 'utf8');
  const main = fs.readFileSync(path.join(repositoryRoot, 'src/main.js'), 'utf8');

  assert.match(virtualEditor, /createCodeMirrorAdapter/);
  assert.doesNotMatch(virtualEditor, /new\s+EditorView\s*\(/);
  assert.doesNotMatch(virtualEditor, /EditorState\.create\s*\(/);
  assert.doesNotMatch(scrollSync, /virtualEditor\??\.view/);
  assert.doesNotMatch(performanceRuntime, /virtualEditor\??\.view/);
  assert.match(performanceRuntime, /virtualEditor\?\.getLineCount\?\.\(\)/);
  assert.match(main, /const\s+virtualEditor\s*=\s*createVirtualEditor\(editorHost\)/);
  assert.match(main, /virtualEditor\.destroy\(\)/);

  const nonEditorSource = walkJavaScript(path.join(repositoryRoot, 'src'))
    .filter(file => !file.includes(`${path.sep}src${path.sep}editor${path.sep}`)
      && !file.includes(`${path.sep}src${path.sep}features${path.sep}editor${path.sep}`));
  const classicSource = walkJavaScript(path.join(repositoryRoot, 'public', 'app'));
  for (const file of [...nonEditorSource, ...classicSource]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /@codemirror\//, `${path.relative(repositoryRoot, file)} must not import CodeMirror`);
  }
});
