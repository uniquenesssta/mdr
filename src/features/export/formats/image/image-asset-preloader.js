import { ExportCancelledError, isExportCancelledError } from '../../task/export-cancellation.js';

// The existing neutral fallback, kept inline so a failed asset never needs another network request.
export const EXPORT_IMAGE_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iODAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iODAiIGZpbGw9IiNlOWVjZWYiLz48dGV4dCB4PSI2MCIgeT0iNDQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiM2Yzc1N2QiPkltYWdlIHVuYXZhaWxhYmxlPC90ZXh0Pjwvc3ZnPg==';

function corsSource(source, stamp) {
  if (/^blob:/i.test(source)) return source;
  // Preserve query and fragment; the fragment must never swallow the cache-busting query.
  const hash = source.indexOf('#');
  const prefix = hash < 0 ? source : source.slice(0, hash);
  return prefix + (prefix.includes('?') ? '&' : '?') + '_cors=' + encodeURIComponent(stamp)
    + (hash < 0 ? '' : source.slice(hash));
}

/** Own image preparation jobs only: anonymous loading, inline pixels, fallback, waits and cleanup. */
export function createImageAssetPreloader({ createImage, createCanvas, setTimer, clearTimer,
  requestFrame, cancelFrame, now = Date.now, timeoutMs = 10000 } = {}) {
  if ([createImage, createCanvas, setTimer, clearTimer, requestFrame, cancelFrame, now].some(fn => typeof fn !== 'function')
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Image preloader requires image, canvas, timer and frame capabilities with a positive timeout.');
  }
  let destroyed = false;
  const jobs = new Set(), owners = new WeakMap();

  async function prepare({ root, task = null, isCurrent = null } = {}) {
    if (destroyed) throw new ExportCancelledError('destroyed');
    if (typeof root?.querySelectorAll !== 'function') throw new TypeError('Image preloader requires a queryable export root.');
    if (isCurrent !== null && typeof isCurrent !== 'function') throw new TypeError('Image source guard must be a function.');
    if (task !== null && (typeof task?.token?.throwIfCancelled !== 'function'
      || typeof task.token.onCancel !== 'function' || typeof task.update !== 'function')) throw new TypeError('Image preloader requires a public task token.');
    task?.token.throwIfCancelled();
    const images = Array.from(root.querySelectorAll('img'));
    const previous = owners.get(root);
    previous?.cancel('replaced');
    const entry = { reason: null, stop: null, cancel(reason) { this.reason = reason; this.stop?.(); } };
    owners.set(root, entry); jobs.add(entry);
    const assertCurrent = () => {
      if (destroyed) throw new ExportCancelledError('destroyed');
      task?.token.throwIfCancelled();
      if (entry.reason || owners.get(root) !== entry) throw new ExportCancelledError(entry.reason || 'replaced');
      if (isCurrent !== null && isCurrent() !== true) throw new ExportCancelledError('document-changed');
      if (destroyed) throw new ExportCancelledError('destroyed');
      task?.token.throwIfCancelled();
    };
    // Every external wait has one terminal cleanup, including callbacks captured before cancellation.
    const wait = start => new Promise((resolve, reject) => {
      let settled = false;
      const disposers = [];
      const finish = (error, value) => {
        if (settled) return;
        settled = true; entry.stop = null;
        const errors = [];
        for (const dispose of disposers.reverse()) try { dispose(); } catch (failure) { errors.push(failure); }
        if (errors.length) error = new AggregateError(error ? [error, ...errors] : errors, 'Image preparation cleanup failed.');
        if (error) reject(error); else resolve(value);
      };
      const cleanup = dispose => { if (settled) dispose(); else disposers.push(dispose); };
      entry.stop = () => finish(new ExportCancelledError(destroyed ? 'destroyed' : entry.reason || 'cancelled'));
      try {
        assertCurrent();
        const timer = setTimer(() => finish(new Error('Image preparation timed out.')), timeoutMs);
        cleanup(() => clearTimer(timer));
        assertCurrent();
        if (!settled) start({ resolve: value => finish(null, value), reject: error => finish(error), cleanup, isPending: () => !settled });
      } catch (error) { finish(error); }
    });
    const load = (source, inline) => wait(({ resolve, reject, cleanup, isPending }) => {
      const loader = createImage();
      if (!loader || typeof loader !== 'object') throw new TypeError('Image loader is unavailable.');
      cleanup(() => { loader.src = ''; });
      cleanup(() => { loader.onerror = null; });
      cleanup(() => { loader.onload = null; });
      assertCurrent();
      if (!inline) loader.crossOrigin = 'anonymous';
      loader.onload = () => {
        if (!isPending()) return;
        try {
          assertCurrent();
          if (inline) { resolve(source); return; }
          const width = loader.naturalWidth, height = loader.naturalHeight;
          if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error('Image dimensions are unavailable.');
          const canvas = createCanvas();
          if (!canvas || typeof canvas.getContext !== 'function' || typeof canvas.toDataURL !== 'function') throw new Error('Image canvas is unavailable.');
          let value;
          try {
            canvas.width = width; canvas.height = height;
            const context = canvas.getContext('2d');
            if (typeof context?.drawImage !== 'function') throw new Error('Image canvas context is unavailable.');
            assertCurrent(); context.drawImage(loader, 0, 0); assertCurrent();
            value = canvas.toDataURL('image/png');
            if (!/^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(value)) throw new Error('Image canvas did not produce inline PNG pixels.');
          } finally { try { canvas.width = 0; } finally { canvas.height = 0; } }
          assertCurrent(); resolve(value);
        } catch (error) { reject(error); }
      };
      loader.onerror = () => reject(new Error('Image could not be loaded anonymously.'));
      assertCurrent(); loader.src = inline ? source : corsSource(source, now());
    });
    const decode = image => typeof image.decode === 'function' ? wait(({ resolve, reject }) => {
      Promise.resolve(image.decode()).then(resolve, reject);
    }) : Promise.resolve();
    const frame = () => wait(({ resolve, cleanup }) => {
      const handle = requestFrame(resolve); cleanup(() => cancelFrame(handle));
    });
    let unsubscribe = () => {};
    const result = { total: images.length, inline: 0, loaded: 0, failed: 0 };
    try {
      unsubscribe = task?.token.onCancel(reason => entry.cancel(reason)) || unsubscribe;
      assertCurrent();
      for (let index = 0; index < images.length; index++) {
        assertCurrent();
        const image = images[index];
        let expected = image.src;
        const assertImage = () => {
          assertCurrent();
          if (image.src !== expected || (typeof root.contains === 'function' && !root.contains(image))) throw new ExportCancelledError('stale-assets');
        };
        const publish = value => {
          assertImage();
          image.removeAttribute?.('srcset'); image.removeAttribute?.('sizes');
          assertImage();
          image.src = value; expected = image.src;
          assertCurrent();
        };
        const inline = /^data:/i.test(expected || '');
        try {
          if (typeof expected !== 'string' || !expected) throw new Error('Image source is unavailable.');
          const value = await load(expected, inline);
          assertImage();
          publish(value);
          await decode(image); assertImage();
          result[inline ? 'inline' : 'loaded']++;
        } catch (error) {
          assertImage();
          if (isExportCancelledError(error)) throw error;
          publish(EXPORT_IMAGE_PLACEHOLDER);
          // A failed placeholder decode is also bounded and cannot prevent the rest of the document.
          try { await decode(image); } catch (failure) { assertCurrent(); if (isExportCancelledError(failure)) throw failure; }
          assertImage(); result.failed++;
        }
        task?.update(90 + Math.round(((index + 1) / Math.max(1, images.length)) * 5),
          `正在准备图片 ${index + 1}/${images.length}`, 'images');
        assertCurrent();
        if ((index + 1) % 8 === 0) { await frame(); assertCurrent(); }
      }
      assertCurrent();
      return Object.freeze(result);
    } finally {
      unsubscribe(); jobs.delete(entry);
      if (owners.get(root) === entry) owners.delete(root);
    }
  }
  return Object.freeze({ prepare, placeholder: EXPORT_IMAGE_PLACEHOLDER, destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const entry of jobs) entry.cancel('destroyed');
  } });
}
