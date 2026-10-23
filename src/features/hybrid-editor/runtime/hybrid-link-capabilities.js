/** Composition-owned link navigation; no DOM discovery or window publication. */
let current = null;
export function configureHybridLinkPreview(value = null) {
  if (value !== null && (typeof value?.open !== 'function' || typeof value?.openExternal !== 'function')) {
    throw new TypeError('Hybrid link preview requires open and openExternal');
  }
  current = value === null ? null : Object.freeze({ open: value.open, openExternal: value.openExternal });
}
export function getHybridLinkPreview() { return current; }
