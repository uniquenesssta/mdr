import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_COMMAND_IDS as C, createMenuCommandBindings } from '../../../src/features/menu/menu-command-bindings.js';
import { createClassicMenuCommandAdapter } from '../../../src/features/menu/compatibility/classic-menu-command-adapter.js';

function commandPort(calls) {
  return {
    has() { return true; },
    invoke(name, ...args) { calls.push(['port', name, ...args]); return true; }
  };
}

test('Atomic 6.10 classic adapter keeps legacy calls outside Menu Model and preserves visual-toggle stay-open behavior', () => {
  const calls = [];
  const globals = new Proxy({}, { get: (_target, name) => (...args) => { calls.push(['global', String(name), ...args]); return true; } });
  const host = {
    markdownEditorDocumentUiCommandPort: commandPort(calls),
    markdownEditorEditorUiCommandPort: commandPort(calls)
  };
  const bindings = createMenuCommandBindings();
  const adapter = createClassicMenuCommandAdapter({ bindings, host, globalObject: globals });
  adapter.start();
  bindings.execute(C.DOCUMENT_SAVE);
  bindings.execute(C.EDITOR_BOLD);
  const visual = bindings.execute(C.EDITOR_TABLE_VISUAL_TOGGLE, { event: 'evt' });
  assert.deepEqual(calls[0].slice(0, 2), ['global', 'saveCurrentFile']);
  assert.deepEqual(calls[1], ['port', 'executeEditorAction', 'bold']);
  assert.deepEqual(calls[2], ['global', 'toggleTableVisualEditing', 'evt']);
  assert.equal(visual.closeMenu, false);
  assert.equal(bindings.has(C.SETTINGS_OPEN), false);
  assert.equal(bindings.has(C.HELP_OPEN), false);
  adapter.destroy();
  assert.equal(bindings.has(C.DOCUMENT_SAVE), false);
  bindings.destroy();
});
