import { readFile, writeFile } from 'node:fs/promises';

const path = 'public/app/editor-tools.js';
let source = await readFile(path, 'utf8');
const before = `    function commitBasicListCommand(method) {
      pushHistory();
      editorToolsCommandPort[method](t('unordered'));
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }

    function formatUnorderedList() {
      commitBasicListCommand('unorderedList');
    }
    function formatOrderedList() {
      commitBasicListCommand('orderedList');
    }
    function formatTaskList() {
      commitBasicListCommand('taskList');
    }`;
const after = `    function finishBasicListCommand() {
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }

    function formatUnorderedList() {
      pushHistory();
      editorToolsCommandPort.unorderedList(t('unordered'));
      finishBasicListCommand();
    }
    function formatOrderedList() {
      pushHistory();
      editorToolsCommandPort.orderedList(t('unordered'));
      finishBasicListCommand();
    }
    function formatTaskList() {
      pushHistory();
      editorToolsCommandPort.taskList(t('unordered'));
      finishBasicListCommand();
    }`;
const first = source.indexOf(before);
if (first < 0) throw new Error('Atomic 5.10 list repair anchor is missing.');
if (source.indexOf(before, first + before.length) >= 0) throw new Error('Atomic 5.10 list repair anchor is duplicated.');
source = source.slice(0, first) + after + source.slice(first + before.length);
if (source.includes('editorToolsCommandPort[method]')) throw new Error('Atomic 5.10 dynamic list dispatch remains.');
await writeFile(path, source, 'utf8');
console.log('[Atomic 5.10] list wrappers now use explicit command-port methods.');
