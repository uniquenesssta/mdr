import test from 'node:test';
import assert from 'node:assert/strict';
import { createMenuController } from '../../../src/features/menu/menu-controller.js';

function fixture({ enabled = true, visible = true, closeMenu = true, result = true } = {}) {
  const item = Object.freeze({ commandId: 'document.save' });
  let stateListener = null;
  let viewListener = null;
  const calls = [];
  const state = {
    declaration: [item],
    isEnabled: () => enabled,
    isVisible: () => visible,
    subscribe(listener) { stateListener = listener; return () => { stateListener = null; }; }
  };
  const bindings = { execute(id, payload) { calls.push(['execute', id, payload]); return { result, closeMenu }; } };
  const view = {
    bindDeclaration(value) { calls.push(['bind', value]); },
    setCommandState(id, value) { calls.push(['state', id, value]); },
    start(listener) { viewListener = listener; calls.push(['start']); return true; },
    destroy() { viewListener = null; calls.push(['destroy']); }
  };
  const controller = createMenuController({
    state, bindings, view,
    closeMenus: () => calls.push(['close']),
    reportError: (message, error) => calls.push(['error', message, error?.message])
  });
  return { controller, calls, emit: payload => viewListener?.(payload), stateChanged: () => stateListener?.() };
}

test('Atomic 6.10 MenuController routes command IDs and closes according to binding policy', () => {
  const f = fixture();
  assert.equal(f.controller.start(), true);
  f.emit({ commandId: 'document.save', event: {}, element: {} });
  assert.equal(f.calls.some(call => call[0] === 'execute'), true);
  assert.equal(f.calls.some(call => call[0] === 'close'), true);
  f.controller.destroy();
  assert.equal(f.calls.at(-1)[0], 'destroy');
  assert.throws(() => f.controller.execute('document.save'), /destroyed/);
});

test('Atomic 6.10 MenuController does not dispatch disabled commands or close stay-open commands', () => {
  const disabled = fixture({ enabled: false });
  disabled.controller.start();
  disabled.emit({ commandId: 'document.save', event: {}, element: {} });
  assert.equal(disabled.calls.some(call => call[0] === 'execute'), false);
  disabled.controller.destroy();

  const stayOpen = fixture({ closeMenu: false });
  stayOpen.controller.start();
  stayOpen.emit({ commandId: 'document.save', event: {}, element: {} });
  assert.equal(stayOpen.calls.some(call => call[0] === 'close'), false);
  stayOpen.controller.destroy();
});
