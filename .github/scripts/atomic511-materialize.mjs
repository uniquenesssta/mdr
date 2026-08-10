import { readFile, writeFile } from 'node:fs/promises';

const path = 'public/app/web-clipper.js';
let source = await readFile(path, 'utf8');

const oldPortHeader = `    const webClipperCompatibilityHost = document.getElementById('compatibility-business-ports');\n    const webClipperPlatformPort = webClipperCompatibilityHost?.markdownEditorPlatformPort;\n    const webClipperEditorControllerPort = webClipperCompatibilityHost?.markdownEditorEditorControllerPort;\n    if (!webClipperEditorControllerPort) throw new Error('Editor Controller compatibility port is unavailable.');\n`;
const nextPortHeader = `    const webClipperCompatibilityHost = document.getElementById('compatibility-business-ports');\n    const webClipperPlatformPort = webClipperCompatibilityHost?.markdownEditorPlatformPort;\n    const webClipperEditorControllerPort = webClipperCompatibilityHost?.markdownEditorEditorControllerPort;\n    const webClipperEditorCommandPort = webClipperCompatibilityHost?.markdownEditorEditorCommandPort;\n    if (!webClipperEditorControllerPort) throw new Error('Editor Controller compatibility port is unavailable.');\n    if (!webClipperEditorCommandPort) throw new Error('Editor Command compatibility port is unavailable.');\n`;
if (!source.includes(oldPortHeader)) throw new Error('Atomic 5.11 port header anchor not found');
source = source.replace(oldPortHeader, nextPortHeader);

const startMarker = `    // 查找与替换\n    let findIndex = 0;\n`;
const endMarker = `    function toggleProxyInput() {`;
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0 || end <= start) throw new Error('Atomic 5.11 Find/Replace block anchors not found');

const replacement = `    // 查找与替换：Atomic 5.11 仅迁移业务命令；现有 modal wrapper 保留至 5.12。\n    function openFindModal() {\n      const findInput = document.getElementById('find-input');\n      const ed = getActiveEditor();\n      if (ed.selectionStart !== ed.selectionEnd) {\n        findInput.value = documentModel\n          ? documentModel.sliceText(ed.selectionStart, ed.selectionEnd)\n          : ed.virtualEditor\n            ? ed.virtualEditor.sliceText(ed.selectionStart, ed.selectionEnd)\n            : ed.value.slice(ed.selectionStart, ed.selectionEnd);\n      }\n      document.getElementById('find-status').textContent = '';\n      const modal = document.getElementById('find-modal');\n      const request = {\n        options: {\n          initialFocus: findInput,\n          onClose: () => { document.getElementById('find-status').textContent = ''; }\n        }\n      };\n      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open', { detail: request }));\n      if (request.error) throw request.error;\n      requestAnimationFrame(() => findInput.select());\n    }\n\n    function closeFindModal() {\n      const modal = document.getElementById('find-modal');\n      const request = { reason: 'feature-close' };\n      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close', { detail: request }));\n      if (request.error) throw request.error;\n    }\n\n    function createFindSearchOptions(status) {\n      const currentDoc = getCurrentDocument?.();\n      const nativeStore = window.markdownEditorDocumentStore;\n      const documentLength = documentModel?.getTextLength?.() ?? getActiveEditor().textLength ?? 0;\n      const useNativeSearch = Boolean(\n        currentDoc?.nativeBacked\n        && nativeStore?.search\n        && documentLength >= ULTRA_LARGE_DOCUMENT_CHARS\n      );\n      if (!useNativeSearch) return {};\n      return {\n        async nativeSearch({ query, from, wrap }) {\n          status.textContent = '正在后台查找…';\n          await saveCurrentDocumentState(false, { waitForNative: true });\n          return nativeStore.search(currentDoc.id, query, from, wrap);\n        },\n        onNativeSearchError(error) {\n          console.warn('Native document search fallback:', error);\n        }\n      };\n    }\n\n    function applyFindMatch(match, status) {\n      if (!match) {\n        status.textContent = t('statusNoMatch');\n        return false;\n      }\n      const el = getActiveEditor();\n      el.setSelectionRange(match.from, match.to);\n      el.focus();\n      el.virtualEditor?.scrollPositionIntoView?.(match.from, 'smooth', 0.45);\n      if (activeResolvedPreviewMode === 'chapter') {\n        updatePreview().then(() => syncEditorSelectionToPreview(true));\n      } else {\n        requestAnimationFrame(() => syncEditorSelectionToPreview(true));\n      }\n      status.textContent = t('statusFoundMatch');\n      return true;\n    }\n\n    async function findNext() {\n      const query = document.getElementById('find-input').value;\n      const status = document.getElementById('find-status');\n      if (!query) {\n        status.textContent = '';\n        return;\n      }\n      const match = await webClipperEditorCommandPort.findNext(query, createFindSearchOptions(status));\n      applyFindMatch(match, status);\n    }\n\n    async function replaceOne() {\n      const query = document.getElementById('find-input').value;\n      const replacementText = document.getElementById('replace-input').value;\n      const status = document.getElementById('find-status');\n      if (!query) {\n        status.textContent = '';\n        return;\n      }\n      const result = await webClipperEditorCommandPort.replaceOne(\n        query,\n        replacementText,\n        createFindSearchOptions(status)\n      );\n      if (result.replaced) {\n        syncEditorFromActive();\n        updatePreview();\n        updateCount();\n        autoSave();\n      }\n      applyFindMatch(result.match, status);\n    }\n\n    function replaceAll() {\n      const query = document.getElementById('find-input').value;\n      const replacementText = document.getElementById('replace-input').value;\n      const status = document.getElementById('find-status');\n      if (!query) {\n        status.textContent = '';\n        return;\n      }\n      const count = webClipperEditorCommandPort.replaceAll(query, replacementText);\n      if (count > 0) {\n        syncEditorFromActive();\n        updatePreview();\n        updateCount();\n        autoSave();\n      }\n      status.textContent = count > 0 ? t('statusReplacedCount', count) : t('statusNoMatch');\n    }\n\n`;

source = source.slice(0, start) + replacement + source.slice(end);

for (const forbidden of [
  'let findIndex = 0',
  'documentModel?.findText',
  'documentModel?.replaceAllText',
  'el.virtualEditor?.findText',
  'el.virtualEditor?.replaceAllText',
  'text.indexOf(query',
  'text.split(query'
]) {
  if (source.includes(forbidden)) throw new Error(`Atomic 5.11 legacy Find/Replace token remains: ${forbidden}`);
}
for (const required of [
  'webClipperEditorCommandPort.findNext(',
  'webClipperEditorCommandPort.replaceOne(',
  'webClipperEditorCommandPort.replaceAll(',
  'async nativeSearch({ query, from, wrap })'
]) {
  if (!source.includes(required)) throw new Error(`Atomic 5.11 materialized token missing: ${required}`);
}

await writeFile(path, source);
