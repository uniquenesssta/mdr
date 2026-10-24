// Observe the default production entry through inspector-held real owners only.
import { assertSingleImplementationRuntime, SINGLE_IMPLEMENTATION_TEXT } from '../../../scripts/stage-16/single-implementation.mjs';

export async function verifySingleImplementationRuntime({ evaluate, platform, paths, canary = null }) {
  if (platform === 'tauri' && (!canary?.path || typeof canary.text !== 'string')) throw new Error('A native run requires an owned real-file canary.');
  const runtime = await evaluate(async (source, canary) => {
    const host = applicationCapabilities;
    await host.markdownEditorDocumentUiCommandPort.invoke('importTextContent', 'r16-single-implementation.md', source);
    host.markdownEditorEditorUiCommandPort.invoke('setLayoutMode', 'both');
    await host.markdownEditorPreviewCommandPort.update();
    await new Promise(accept => requestAnimationFrame(() => requestAnimationFrame(accept)));
    let nativeCanaryExact = null;
    if (canary) {
      const read = await window.__TAURI_INTERNALS__.invoke('read_dropped_file', { path: canary.path });
      nativeCanaryExact = read.content === canary.text;
    }
    return {
      ready: document.documentElement.classList.contains('app-ready'),
      shells: document.querySelectorAll('[data-ui-shell="app"]').length,
      editors: document.querySelectorAll('#editor .cm-editor').length,
      previews: document.querySelectorAll('#preview').length,
      exactText: editorApi.getText() === source,
      previewRendered: document.querySelector('#preview h1')?.textContent === 'R16 single implementation 中文'
        && document.querySelector('#preview strong')?.textContent === 'Current entry',
      businessGlobals: Object.getOwnPropertyNames(window).filter(name => /^markdownEditor/.test(name)),
      e2ePublished: Object.hasOwn(window, '__markdownEditorE2E'),
      globalTauriPublished: typeof window.__TAURI__ !== 'undefined',
      nativeIpc: typeof window.__TAURI_INTERNALS__?.invoke === 'function', nativeCanaryExact,
      scripts: Array.from(document.scripts).map(row => ({ type: row.type, url: row.src })),
      resources: performance.getEntriesByType('resource').map(row => row.name)
    };
  }, SINGLE_IMPLEMENTATION_TEXT, canary);
  assertSingleImplementationRuntime(runtime, { platform, paths });
  return runtime;
}
