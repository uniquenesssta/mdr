const PORT_KEY = 'markdownEditorPresentationPort';

/**
 * Responsibility: Expose the canonical shared presentation contract to classic consumers that have not reached their rewrite stage.
 * State/side effects: No presentation state is copied; methods delegate to the frozen API instance and explicit capability loader.
 * Lifecycle: destroy() only unmounts the scoped compatibility property.
 */
export function mountClassicPreviewPresentationPort(host, presentation, options = {}) {
  if (!host || typeof host !== 'object') throw new TypeError('Preview Presentation compatibility port requires a host.');
  if (!presentation?.markdown || !presentation?.math || !presentation?.mermaid || !presentation?.code) {
    throw new TypeError('Preview Presentation compatibility port requires the canonical presentation API.');
  }
  if (Object.hasOwn(host, PORT_KEY)) throw new Error('Preview Presentation compatibility port is already mounted.');
  const loadDomToImage = typeof options.loadDomToImage === 'function' ? options.loadDomToImage : null;
  const port = Object.freeze({
    markdown: presentation.markdown,
    code: presentation.code,
    math: presentation.math,
    mermaid: presentation.mermaid,
    loadDomToImage: () => {
      if (!loadDomToImage) throw new Error('DOM-to-image capability is unavailable.');
      return loadDomToImage();
    }
  });
  Object.defineProperty(host, PORT_KEY, { value: port, configurable: true, enumerable: false });
  let destroyed = false;
  return Object.freeze({
    port,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_KEY] === port) delete host[PORT_KEY];
    }
  });
}
