import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');
const exists = path => access(new URL(path, ROOT), constants.F_OK).then(() => true, () => false);

test('Atomic 6.10 Menu Model has one public entry and no business calls in model/controller/view/bindings', async () => {
  const [entry, state, bindings, controller, view, bootstrap] = await Promise.all([
    read('src/features/menu/index.js'),
    read('src/features/menu/menu-state.js'),
    read('src/features/menu/menu-command-bindings.js'),
    read('src/features/menu/menu-controller.js'),
    read('src/features/menu/menu-view.js'),
    read('src/bootstrap/module-entry.js')
  ]);
  for (const source of [state, bindings, controller, view]) {
    assert.doesNotMatch(source, /\b(saveCurrentFile|saveAsMarkdown|exportFile|exportPDF|newDocument|openUrlModal)\s*\(/);
    assert.doesNotMatch(source, /public\/app|document-model|localStorage|markdownEditorDocumentModel/);
  }
  assert.match(entry, /createMenuState/);
  assert.match(entry, /createMenuCommandBindings/);
  assert.match(entry, /createMenuController/);
  assert.match(entry, /createMenuView/);
  assert.match(bootstrap, /from '\.\.\/features\/menu\/index\.js'/);
  assert.doesNotMatch(bootstrap, /features\/menu\/(menu-state|menu-controller|menu-view|menu-command-bindings)\.js/);
});

test('Atomic 6.10 MenuView boundary remains intact after 6.11 and 6.12', async () => {
  assert.equal(await exists('src/features/menu/recent-files-menu-controller.js'), true);
  const [view, recentFiles] = await Promise.all([
    read('src/features/menu/menu-view.js'),
    read('src/features/menu/recent-files-menu-controller.js')
  ]);
  assert.doesNotMatch(view, /getBoundingClientRect|innerWidth|innerHeight|setTimeout|localStorage|recentFiles|recent-files-menu-controller/);
  assert.match(recentFiles, /createRecentFilesMenuController/);
  assert.doesNotMatch(recentFiles, /getBoundingClientRect|innerWidth|innerHeight/);
});

test('Atomic 6.10 classic compatibility is isolated from canonical Menu Model files', async () => {
  const adapter = await read('src/features/menu/compatibility/classic-menu-command-adapter.js');
  assert.match(adapter, /saveCurrentFile/);
  assert.match(adapter, /markdownEditorEditorUiCommandPort/);
  assert.match(adapter, /markdownEditorDocumentUiCommandPort/);
  assert.doesNotMatch(adapter, /MENU_DECLARATION|menu-state|menu-view/);
});
