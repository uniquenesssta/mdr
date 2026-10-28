// Test-side contract adapter shared by the built-app runner and export scenarios.
// Only the explicit public E2E capability is callable. No DOM/editor fallback,
// source-file evaluation, retained browser objects or owned asynchronous work.
const methods = Object.freeze(['snapshot', 'getComponentStates', 'getPreviewStats', 'getEditorValue', 'getState',
  'loadMarkdown', 'setLayout', 'setVisualEditing', 'revealPosition', 'revealText', 'waitForIdle', 'clearStorage']);

export function createApplicationDriver(page) {
  if (typeof page?.evaluate !== 'function') throw new TypeError('Application driver requires a CDP page.');
  return Object.freeze(Object.fromEntries(methods.map(method => [method, async (...args) => {
    const result = await page.evaluate(`(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__markdownEditorE2E');
      const api = descriptor && 'value' in descriptor ? descriptor.value : null;
      if (!api || typeof api[${JSON.stringify(method)}] !== 'function') {
        throw new Error('Explicit public E2E capability unavailable: ${method}. Open the built app with ?e2e=1.');
      }
      return api[${JSON.stringify(method)}](...${JSON.stringify(args)});
    })()`, method === 'getEditorValue' ? { chunkedString: true } : undefined);
    if (method === 'waitForIdle' && result !== true) throw new Error('Public E2E idle wait did not complete.');
    return result;
  }])));
}
