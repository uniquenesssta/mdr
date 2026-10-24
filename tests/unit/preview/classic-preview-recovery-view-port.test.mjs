import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewRecoveryView } from '../../../src/features/preview/index.js';
function fixture(initial = null) {
  let current = initial;
  const root = { querySelector: () => current, replaceChildren: body => { current = body; } };
  const documentRef = { createElement: () => ({ dataset: {}, childElementCount: 0 }) };
  return { root, documentRef, body: () => current, view: createPreviewRecoveryView({ root, documentRef }) };
}
test('R16-08 direct Recovery View preserves stable DOM and owns only its recovery replacement', () => {
  const stable = { dataset: {}, childElementCount: 1 }, h = fixture(stable);
  assert.deepEqual(h.view.inspect(), { present: true, recovery: false, empty: false });
  assert.equal(h.view.recover({ preserveStable: true }).body, stable);
  assert.equal(h.view.isRecoveryBody(stable), false);
  const recovery = h.view.recover({ message: 'retry' });
  assert.equal(recovery.body.textContent, 'retry');
  assert.equal(h.view.isRecoveryBody(recovery.body), true);
  assert.deepEqual(h.view.inspect(), { present: true, recovery: true, empty: true });
  h.view.destroy();
});
test('R16-08 Recovery View rejects malformed DOM dependencies before construction', () => {
  assert.throws(() => createPreviewRecoveryView(), /preview root/);
  assert.throws(() => createPreviewRecoveryView({ root: { querySelector() {}, replaceChildren() {} } }), /documentRef/);
});
test('R16-08 direct Recovery disposal is terminal and does not replace stable DOM', () => {
  const stable = { dataset: {}, childElementCount: 1 }, h = fixture(stable);
  h.view.destroy(); h.view.destroy();
  assert.equal(h.body(), stable);
  assert.throws(() => h.view.inspect(), /destroyed/);
  assert.throws(() => h.view.recover(), /destroyed/);
});
