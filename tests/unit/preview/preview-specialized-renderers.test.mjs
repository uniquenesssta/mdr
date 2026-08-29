import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskListRenderer } from '../../../src/features/preview/render/task-list-renderer.js';
import { createCodeRenderer } from '../../../src/features/preview/render/code-renderer.js';
import { createMathRenderer } from '../../../src/features/preview/render/math-renderer.js';
import { createMermaidRenderer } from '../../../src/features/preview/render/mermaid-renderer.js';

function classes(...values) {
  const set = new Set(values);
  return {
    add(...items) { items.forEach(item => set.add(item)); },
    remove(...items) { items.forEach(item => set.delete(item)); },
    contains(item) { return set.has(item); },
    [Symbol.iterator]() { return set[Symbol.iterator](); }
  };
}

test('Atomic 7.8 Task List and Math renderers keep independent presentation responsibilities', () => {
  const ul = { tagName: 'UL', classList: classes() };
  const li = { classList: classes(), closest(selector) { return selector === 'ul, ol' ? ul : null; } };
  const checkbox = {
    matches(selector) { return selector === 'input[type="checkbox"]'; },
    closest(selector) { return selector === 'li' ? li : null; }
  };
  const root = { querySelectorAll() { return [checkbox]; } };
  const taskRenderer = createTaskListRenderer({ root });
  assert.equal(taskRenderer.render(), 1);
  assert.equal(li.classList.contains('task-item'), true);
  assert.equal(ul.classList.contains('task-list'), true);

  const mathCalls = [];
  const mathRenderer = createMathRenderer({
    presentation: { math: { delimiters: [{ left: '$', right: '$' }], renderTree(node, options) { mathCalls.push({ node, options }); } } }
  });
  const mathRoot = { id: 'math-root' };
  assert.equal(mathRenderer.render([mathRoot]), 1);
  assert.equal(mathCalls[0].node, mathRoot);
  assert.equal(mathCalls[0].options.delimiters.length, 1);
  taskRenderer.destroy();
  mathRenderer.destroy();
});

test('Atomic 7.8 Code Renderer uses shared code presentation and one delegated copy listener pair', async () => {
  const listeners = new Map();
  const root = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    contains() { return true; },
    querySelectorAll() { return []; }
  };
  const pre = {
    dataset: { sourceStartIndex: '10', sourceEndIndex: '30' },
    classList: classes(),
    insertBefore(button) { button.parentElement = pre; pre.button = button; }
  };
  const code = {
    textContent: 'const x = 1;\n',
    parentElement: pre,
    classList: classes('language-js'),
    matches(selector) { return selector === 'code'; },
    querySelectorAll() { return []; }
  };
  const scope = {
    matches() { return false; },
    querySelectorAll(selector) { return selector === 'pre > code' ? [code] : []; }
  };
  const documentRef = {
    createElement(tag) {
      assert.equal(tag, 'button');
      return {
        className: '',
        setAttribute() {},
        closest(selector) { return selector === 'pre' ? pre : selector === '.preview-code-copy' ? this : null; }
      };
    }
  };
  const highlighted = [];
  const copied = [];
  const notices = [];
  const renderer = createCodeRenderer({
    root,
    documentRef,
    documentModel: { sliceText() { return '```js\nconst x = 1;\n```'; } },
    presentation: { code: {
      getNormalizedCodeLanguage(language) { return language === 'js' ? 'javascript' : language; },
      renderHighlightedCodeRows(target, source, language, options) { highlighted.push({ target, source, language, options }); return { ok: true }; }
    } },
    async copyText(value) { copied.push(value); },
    notify(message) { notices.push(message); }
  });
  renderer.start();
  assert.equal(renderer.render([scope]), 1);
  assert.equal(pre.dataset.previewCodeEnhanced, 'true');
  assert.equal(pre.dataset.codeLanguage, 'javascript');
  assert.equal(pre.dataset.codeSourceStartIndex, '16');
  assert.equal(highlighted[0].options.variant, 'preview');
  const button = pre.button;
  await listeners.get('click')({
    target: button,
    preventDefault() {},
    stopPropagation() {}
  });
  assert.deepEqual(copied, ['const x = 1;\n']);
  assert.deepEqual(notices, ['代码已复制']);
  renderer.destroy();
  assert.equal(listeners.size, 0);
});

test('Atomic 7.8 Mermaid Renderer delegates rendering and prevents post-destroy authority', async () => {
  let replacement = null;
  const pre = {
    dataset: { sourceStartIndex: '7', sourceLine: '2' },
    classList: classes(),
    attributes: [{ name: 'data-source-line', value: '2' }],
    isConnected: true,
    replaceWith(node) { replacement = node; }
  };
  const code = {
    textContent: 'graph TD; A-->B',
    closest(selector) { return selector === 'pre' ? pre : null; }
  };
  const scope = {
    matches() { return false; },
    querySelectorAll(selector) { return selector === 'pre > code.language-mermaid' ? [code] : []; }
  };
  const root = { querySelectorAll() { return []; } };
  const documentRef = {
    body: {},
    createElement(tag) {
      assert.equal(tag, 'div');
      return { className: '', attrs: new Map(), setAttribute(name, value) { this.attrs.set(name, value); } };
    }
  };
  const calls = [];
  const renderer = createMermaidRenderer({
    root,
    documentRef,
    presentation: { mermaid: {
      getTheme() { return 'dark'; },
      async renderDiagram(container, source, options) { calls.push({ container, source, options }); return { status: 'rendered' }; }
    } }
  });
  const result = await renderer.render([scope]);
  assert.deepEqual(result, { requested: 1, rendered: 1, failed: 0, cancelled: 0 });
  assert.ok(replacement);
  assert.equal(calls[0].options.theme, 'dark');
  assert.equal(calls[0].options.cacheKey, 'preview:7');
  renderer.destroy();
  await assert.rejects(() => renderer.render([scope]), /destroyed/);
});
