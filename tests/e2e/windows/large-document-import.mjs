import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Real Windows IPC, native drop subscription and file-input routes. The drop
// event uses Tauri's event transport; it does not simulate an OS shell gesture.
export async function verifyLargeDocumentImport({ browser, filePath, diagnostics = {} }) {
  const source = (await readFile(filePath, 'utf8')).replace(/\r\n/g, '\n');
  const expected = { characters: source.length, sha256: createHash('sha256').update(source).digest('hex') };
  const before = await browser.inspect(() => applicationCapabilities
    .markdownEditorDocumentControllerPort.records.map(record => record.id));
  const observations = diagnostics.observations = [];
  let first;
  const inspect = async scenario => {
    const state = await browser.inspect(async () => {
      const documents = applicationCapabilities.markdownEditorDocumentControllerPort;
      const editor = document.getElementById('editor');
      const bytes = new TextEncoder().encode(editorApi.getText());
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const records = JSON.parse(localStorage.getItem('md_editor_documents') || '[]');
      return { id: documents.activeId, characters: editorApi.getTextLength(), nativeBacked: documents.getActiveRecord()?.nativeBacked,
        sha256: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join(''),
        legacyBody: localStorage.getItem('md_editor_content') !== null,
        bodyInMetadata: records.some(record => record.nativeBacked && Object.hasOwn(record, 'content')),
        visibleEditorCharacters: document.querySelector('#editor .cm-content')?.textContent?.length || 0,
        sessionCharacters: localStorage.getItem('md_editor_documents')?.length || 0 };
    });
    observations.push({ scenario, ...state });
    assert.equal(state.characters, expected.characters);
    assert.equal(state.sha256, expected.sha256);
    assert.equal(state.nativeBacked, true);
    assert.equal(state.legacyBody, false);
    assert.equal(state.bodyInMetadata, false);
    assert.ok(state.visibleEditorCharacters > 0, 'The editor must display the imported document.');
    assert.ok(state.sessionCharacters < 32 * 1024);
    return state.id;
  };
  try {
    assert.equal(await browser.inspect(path => applicationCapabilities
      .markdownEditorDocumentUiCommandPort.invoke('openImportPath', path), filePath), true);
    first = await inspect('native-open-path-after-picker');
    for (const route of ['native-drop-event', 'browser-file-input']) {
      const count = await browser.inspect(() => applicationCapabilities
        .markdownEditorDocumentControllerPort.records.length);
      await browser.inspect(async (route, path) => {
        if (route === 'native-drop-event') {
          await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
            event: 'tauri://drag-drop', payload: { paths: [path], position: { x: 300, y: 300 } }
          });
        } else {
          const data = new DataTransfer();
          data.items.add(new File([editorApi.getText()],
            'large-import-input.md', { type: 'text/markdown' }));
          const input = document.getElementById('importFile');
          input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, route, filePath);
      await browser.waitUntil(() => browser.inspect(expectedCount => {
        const documents = applicationCapabilities.markdownEditorDocumentControllerPort;
        return documents.records.length === expectedCount && documents.getActiveRecord()?.nativeBacked === true;
      }, count + 1), { timeout: 30_000, timeoutMsg: `Large import did not commit: ${route}` });
      await inspect(route);
    }
    await browser.inspect(id => applicationCapabilities
      .markdownEditorDocumentControllerPort.openDocument(id), first);
    await inspect('switch-and-reopen-native-body');
    return { status: 'passed', expected, observations };
  } finally {
    await browser.inspect(async previous => {
      const documents = applicationCapabilities.markdownEditorDocumentControllerPort;
      for (const record of [...documents.records]) {
        if (!previous.includes(record.id)) await documents.closeDocument(record.id, { persistDirty: false });
      }
    }, before);
  }
}
