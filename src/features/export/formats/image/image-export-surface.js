/** Owns only mounted image capture nodes, layout/style leases and preview projection.
 * Uses injected DOM/layout/styles; never reads models, starts tasks or writes files.
 */
export function createImageExportSurface({ documentRef, container, stage, previewImage, layout, styles, readStyle } = {}) {
  if (typeof documentRef?.createElement !== 'function' || typeof container?.appendChild !== 'function'
    || !stage || !previewImage || typeof layout?.mount !== 'function' || typeof styles?.apply !== 'function'
    || typeof readStyle !== 'function') throw new TypeError('Image capture surface requires DOM, layout and styles.');
  let destroyed = false;
  const mounted = new Set();
  const alive = () => { if (destroyed) throw new Error('Image capture surface is destroyed.'); };
  function clearPreview() {
    previewImage.removeAttribute('src');
    previewImage.classList.add('is-hidden');
  }
  return Object.freeze({
    mount(body, options) {
      alive();
      const root = documentRef.createElement('div');
      root.className = 'preview-content';
      let styleLease, layoutLease, released = false;
      const release = () => {
        if (released) return false;
        released = true;
        mounted.delete(release);
        let failure;
        for (const clean of [() => layoutLease?.release(), () => styleLease?.release(),
          () => { if (root.parentNode) root.parentNode.removeChild(root); }]) {
          try { clean(); } catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
        return true;
      };
      mounted.add(release);
      try {
        root.replaceChildren(body);
        styleLease = styles.apply(root, 'image');
        container.appendChild(root);
        layoutLease = layout.mount({ root, stage, options });
      } catch (error) {
        try { release(); } catch { /* retain the mount failure after attempting every release */ }
        throw error;
      }
      return Object.freeze({ root,
        measure() { alive(); if (released) throw new Error('Image capture surface is released.'); return layoutLease.measure(); },
        background() { alive(); return readStyle(root).backgroundColor || '#ffffff'; }, release });
    },
    publish(dataUrl) { alive(); previewImage.src = dataUrl; previewImage.classList.remove('is-hidden'); },
    clearPreview,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      let failure;
      for (const release of [...mounted]) { try { release(); } catch (error) { failure ??= error; } }
      try { clearPreview(); } catch (error) { failure ??= error; }
      if (failure) throw failure;
    }
  });
}
