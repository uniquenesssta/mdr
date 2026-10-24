import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_COMMAND_IDS as C, createMenuCommandBindings, createMenuController } from '../../../src/features/menu/index.js';

test('R16-08 direct Menu controller preserves dynamic commands, close policy and binding ownership', async () => {
  const host = {};
  const bindings = createMenuCommandBindings();
  const calls = [];
  bindings.register(C.RECENT_FILE_OPEN, payload => { calls.push(payload); return Promise.resolve('opened'); });
  let closes = 0;
  const errors = [];
  const port = createMenuController({ bindings, state: { declaration: [], isEnabled: () => true, isVisible: () => true, subscribe: () => () => {} }, view: { bindDeclaration() {}, setCommandState() {}, start() {}, destroy() {} },
    closeMenus() { closes += 1; },
    reportError(message, error) { errors.push({ message, error }); }
  });
  assert.equal(Object.hasOwn(host, 'markdownEditorMenuCommandPort'), false);
  assert.equal(port.has(C.RECENT_FILE_OPEN), true);
  const result = port.execute(C.RECENT_FILE_OPEN, { path: 'C:/Notes/A.md' });
  assert.equal(await result, 'opened');
  assert.deepEqual(calls, [{ path: 'C:/Notes/A.md' }]);
  assert.equal(closes, 1);
  assert.deepEqual(errors, []);
  port.destroy();
  port.destroy();
  assert.equal('markdownEditorMenuCommandPort' in host, false);
  assert.equal(bindings.has(C.RECENT_FILE_OPEN), true);
  assert.throws(() => port.has(C.RECENT_FILE_OPEN), /destroyed/);
  bindings.destroy();
});

test('R16-08 direct Menu controller contains command errors and rejects operations after disposal', () => {
  const host = {};
  const bindings = createMenuCommandBindings();
  const errors = [];
  const port = createMenuController({ bindings, state: { declaration: [], isEnabled: () => true, isVisible: () => true, subscribe: () => () => {} }, view: { bindDeclaration() {}, setCommandState() {}, start() {}, destroy() {} },
    reportError(message, error) { errors.push([message, error.message]); }
  });
  assert.equal(port.has(C.RECENT_FILE_OPEN), false);
  assert.equal(port.execute(C.RECENT_FILE_OPEN, {}), false);
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /document\.open-recent/);
  port.destroy();
  bindings.destroy();
});
