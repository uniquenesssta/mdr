import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewRecoveryView } from '../../../src/features/preview/ui/preview-recovery-view.js';

function createBody({ className = 'markdown-body', children = 1 } = {}) {
  const node = {
    className,
    dataset: {},
    children: Array.from({ length: children }, () => ({})),
    textContent: '',
    get childElementCount() { return this.children.length; },
    classList: {
      contains(name) { return String(node.className).split(/\s+/).includes(name); }
    }
  };
  return node;
}

function createHarness(initialBody = null) {
  let currentBody = initialBody;
  const root = {
    replaceCount: 0,
    querySelector(selector) {
      assert.equal(selector, '.markdown-body');
      return currentBody;
    },
    replaceChildren(body) {
      this.replaceCount += 1;
      currentBody = body || null;
    }
  };
  const documentRef = {
    createElement(tag) {
      assert.equal(tag, 'div');
      return createBody({ className: '', children: 0 });
    }
  };
  return { root, documentRef, get body() { return currentBody; } };
}

test('Atomic 7.13 preserves an existing stable preview without replacing its DOM', () => {
  const stableBody = createBody();
  const harness = createHarness(stableBody);
  const view = createPreviewRecoveryView(harness);
  const result = view.recover({ preserveStable: true });
  assert.equal(result.body, stableBody);
  assert.equal(result.preserved, true);
  assert.equal(result.replaced, false);
  assert.equal(harness.root.replaceCount, 0);
  assert.deepEqual(view.inspect(), { present: true, recovery: false, empty: false });
});

test('Atomic 7.13 renders the lightweight recovery body only when stable preview cannot be preserved', () => {
  const harness = createHarness();
  const view = createPreviewRecoveryView(harness);
  const result = view.recover();
  assert.equal(result.preserved, false);
  assert.equal(result.replaced, true);
  assert.equal(result.recovery, true);
  assert.equal(harness.root.replaceCount, 1);
  assert.equal(harness.body.className, 'markdown-body preview-loading');
  assert.equal(harness.body.dataset.previewRecovery, 'true');
  assert.equal(harness.body.textContent, '后台预览恢复中，编辑内容与自动保存不受影响…');
  assert.deepEqual(view.inspect(), { present: true, recovery: true, empty: true });
});

test('Atomic 7.13 replaces an older recovery body instead of mistaking it for stable preview', () => {
  const oldRecovery = createBody({ className: 'markdown-body preview-loading', children: 0 });
  const harness = createHarness(oldRecovery);
  const view = createPreviewRecoveryView(harness);
  const result = view.recover({ preserveStable: true, message: 'retrying' });
  assert.notEqual(result.body, oldRecovery);
  assert.equal(result.preserved, false);
  assert.equal(result.recovery, true);
  assert.equal(harness.body.textContent, 'retrying');
  assert.equal(view.isRecoveryBody(harness.body), true);
});

test('Atomic 7.13 Recovery View validates dependencies and owns no editor mutation contract', () => {
  assert.throws(() => createPreviewRecoveryView(), /preview root/);
  assert.throws(() => createPreviewRecoveryView({ root: { querySelector() {}, replaceChildren() {} } }), /documentRef/);
  const harness = createHarness(createBody());
  const view = createPreviewRecoveryView(harness);
  assert.equal('editor' in view, false);
  assert.equal('setText' in view, false);
  assert.equal('replaceRange' in view, false);
});

test('Atomic 7.13 Recovery View destroy is idempotent and terminal without clearing stable DOM', () => {
  const stableBody = createBody();
  const harness = createHarness(stableBody);
  const view = createPreviewRecoveryView(harness);
  view.destroy();
  view.destroy();
  assert.equal(harness.body, stableBody);
  assert.equal(harness.root.replaceCount, 0);
  assert.throws(() => view.inspect(), /destroyed/);
  assert.throws(() => view.recover(), /destroyed/);
});
