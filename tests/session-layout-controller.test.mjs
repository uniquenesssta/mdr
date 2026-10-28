import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentSessionStore } from '../src/features/documents/index.js';
import { createSessionLayoutController } from '../src/features/layout/session-layout-controller.js';

test('mode availability follows the real active session, including closing the last document', () => {
  const session = createDocumentSessionStore();
  const controls = Array.from({ length: 4 }, () => ({ disabled: false, title: 'mode' }));
  let writingApplications = 0;
  const controller = createSessionLayoutController({ session, controls, applyWritingMode() { writingApplications++; } });
  controller.start(); controller.start();
  assert.equal(writingApplications, 1);
  assert.equal(controller.hasDocument, false);
  assert.ok(controls.every(button => button.disabled));
  session.insertRecord({ id: 'first', title: 'first.md' });
  assert.equal(controller.hasDocument, false, 'metadata without an active document must stay locked');
  session.setActive('first');
  assert.equal(controller.hasDocument, true);
  assert.ok(controls.every(button => !button.disabled && button.title === 'mode'));
  assert.equal(writingApplications, 2);
  session.updateRecord('first', { title: 'renamed.md' });
  session.insertRecord({ id: 'second', title: 'second.md' }, { activate: true });
  assert.equal(writingApplications, 2, 'metadata changes and switching active documents retain the selected mode');
  session.removeRecord('first');
  assert.equal(writingApplications, 2);
  session.removeRecord('second');
  assert.equal(controller.hasDocument, false);
  assert.ok(controls.every(button => button.disabled));
  assert.equal(writingApplications, 3);
  controller.destroy(); controller.destroy();
  assert.ok(controls.every(button => !button.disabled && button.title === 'mode'));
  session.insertRecord({ id: 'later', title: 'later.md' }, { activate: true });
  assert.equal(writingApplications, 3, 'destroy releases the session listener');
  assert.throws(() => controller.start(), /destroyed/);
  session.destroy();
});

test('mounting around an existing active document preserves its selected mode', () => {
  const session = createDocumentSessionStore({ initialRecords: [{ id: 'existing', title: 'existing.md' }], activeId: 'existing' });
  let resets = 0;
  const controller = createSessionLayoutController({ session, controls: [], applyWritingMode() { resets++; } });
  controller.start();
  assert.equal(controller.hasDocument, true);
  assert.equal(resets, 0);
  controller.destroy(); session.destroy();
});
