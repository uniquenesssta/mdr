/**
 * Responsibility: Lazily load optional browser-only vendor capabilities without exposing them on window.
 * State/side effects: Module-local promises only; failed loads clear their cache for retry.
 */
let domToImagePromise = null;

export function loadDomToImage() {
  if (!domToImagePromise) {
    domToImagePromise = import('dom-to-image-more')
      .then(module => module.default || module)
      .catch(error => {
        domToImagePromise = null;
        throw error;
      });
  }
  return domToImagePromise;
}
