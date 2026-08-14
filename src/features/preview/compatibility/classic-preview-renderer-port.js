/**
 * Responsibility: Mount PreviewRendererPort on the scoped classic compatibility host during Stage 7 migration.
 * Imports: None.
 * Exports: mountClassicPreviewRendererPort().
 * State/side effects: Owns only one host property; renderer state and DOM remain owned by PreviewRendererPort.
 * Lifecycle: destroy() removes only the property mounted by this adapter.
 */
const PORT_KEY = 'markdownEditorPreviewRendererPort';
const METHODS = Object.freeze([
  'patchHtml',
  'patchBlocks',
  'createBlockNodes',
  'applyBlockSourceRange',
  'renderTaskLists',
  'renderCode',
  'renderMath',
  'renderMermaid'
]);

export function mountClassicPreviewRendererPort(host, renderer) {
  if (!host || typeof host !== 'object') throw new TypeError('Classic Preview Renderer Port requires a host.');
  if (!renderer || typeof renderer !== 'object') throw new TypeError('Classic Preview Renderer Port requires PreviewRendererPort.');
  if (host[PORT_KEY]) throw new Error('Classic Preview Renderer Port is already mounted.');
  for (const method of METHODS) {
    if (typeof renderer[method] !== 'function') {
      throw new TypeError(`Classic Preview Renderer Port requires renderer.${method}().`);
    }
  }

  let destroyed = false;
  const port = Object.freeze(Object.fromEntries(METHODS.map(method => [
    method,
    (...args) => {
      if (destroyed) throw new Error('Classic Preview Renderer Port is destroyed.');
      return renderer[method](...args);
    }
  ])));
  host[PORT_KEY] = port;

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_KEY] === port) delete host[PORT_KEY];
    }
  });
}
