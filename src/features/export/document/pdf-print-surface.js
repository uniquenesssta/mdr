import { ExportCancelledError } from '../task/export-cancellation.js';

/** Same-origin initial blank frames isolate printing without navigating or mutating Preview/Hybrid DOM. */
export function createPdfPrintSurface({ documentRef, styles, printWindow, setTimer, clearTimer } = {}) {
  if (!documentRef?.body?.appendChild || typeof documentRef.createElement !== 'function'
    || typeof styles?.getCss !== 'function' || ![printWindow, setTimer, clearTimer].every(x => typeof x === 'function')) {
    throw new TypeError('PDF print surface requires document, stylesheet, platform print and timer capabilities.');
  }
  let destroyed = false;
  const leases = new Set();
  function mount({ body, name, fontCss } = {}) {
    if (destroyed) throw new ExportCancelledError('destroyed');
    if (!body || typeof name !== 'string' || typeof fontCss !== 'string' || !fontCss.trim()) throw new TypeError('PDF print body, name and embedded fonts are required.');
    const css = styles.getCss('pdf');
    if (typeof css !== 'string' || /<\/style/i.test(css + fontCss)) throw new TypeError('PDF print stylesheet is unsafe.');
    const frame = documentRef.createElement('iframe');
    frame.dataset.exportPrint = 'pdf'; frame.title = 'PDF 打印文档'; frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '794px', height: '1123px', border: '0', pointerEvents: 'none' });
    let printTimer, fallbackTimer, readinessTimer, onAfterPrint, frameWindow, finished = false, printing = false, eventReceived = false, issued = false, prepared = false;
    let resolveReady, rejectReady, resolvePrint, rejectPrint, printRequested = false;
    const clear = () => {
      let failure;
      for (const release of [
        ...[printTimer, fallbackTimer, readinessTimer].filter(x => x !== undefined).map(handle => () => clearTimer(handle)),
        () => { if (onAfterPrint) frameWindow?.removeEventListener('afterprint', onAfterPrint); },
        () => { if (frame.parentNode) frame.parentNode.removeChild(frame); }
      ]) { try { release(); } catch (error) { failure ??= error; } }
      leases.delete(lease);
      return failure;
    };
    const finish = (reason, error) => {
      if (finished) return;
      finished = true;
      const cleanupFailure = clear();
      const failure = error || cleanupFailure;
      if (failure) { rejectReady?.(failure); rejectPrint?.(failure); }
      else resolvePrint?.(reason);
    };
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // A released or failed mount may precede the caller's first await; always observe its readiness failure.
    ready.catch(() => {});
    const lease = Object.freeze({ ready, print({ beforePrint } = {}) {
      if (finished || destroyed) return Promise.reject(new ExportCancelledError('destroyed'));
      if (!prepared || printRequested || typeof beforePrint !== 'function') return Promise.reject(new TypeError('PDF print requires one prepared, guarded publication.'));
      printRequested = true;
      return new Promise((resolve, reject) => {
        resolvePrint = resolve; rejectPrint = reject;
        onAfterPrint = () => { if (!issued) return; eventReceived = true; if (!printing) finish('afterprint'); };
        try {
          frameWindow.addEventListener('afterprint', onAfterPrint);
          printTimer = setTimer(async () => {
            if (finished) return;
            try {
              beforePrint();
              if (finished) return;
              printing = true;
              issued = true;
              await printWindow(frameWindow);
              printing = false;
              if (finished) return;
              if (eventReceived) finish('afterprint');
              // Start recovery only after the blocking print call returns, never while its dialog is open.
              else fallbackTimer = setTimer(() => finish('timeout'), 1200);
            } catch (error) { printing = false; finish('failed', error); }
          }, 80);
        } catch (error) { finish('failed', error); }
      });
    }, release() { finish('released', new ExportCancelledError('destroyed')); } });
    leases.add(lease);
    try {
      documentRef.body.appendChild(frame);
      const doc = frame.contentDocument;
      frameWindow = frame.contentWindow;
      if (!doc?.head || !doc.body || !doc.fonts || typeof doc.importNode !== 'function' || !frame.contentWindow?.addEventListener) throw new Error('PDF isolated print document is unavailable.');
      doc.documentElement.lang = 'zh-CN'; doc.title = name.replace(/\.pdf$/i, '');
      const meta = doc.createElement('meta'); meta.setAttribute('charset', 'utf-8'); doc.head.appendChild(meta);
      const sheet = doc.createElement('style'); sheet.textContent = css; doc.head.appendChild(sheet);
      const fonts = doc.createElement('style'); fonts.dataset.exportFonts = 'katex'; fonts.textContent = fontCss; doc.head.appendChild(fonts);
      const root = doc.importNode(body, true); root.classList.add('export-document'); root.dataset.exportFormat = 'pdf';
      doc.body.replaceChildren(root);
      doc.body.style.margin = '0';
      readinessTimer = setTimer(() => finish('failed', new Error('PDF print resources timed out.')), 10000);
      const images = Array.from(root.querySelectorAll('img'), image => typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve());
      // Loading each embedded face gives the new print document the same complete KaTeX resources as HTML/Word.
      Promise.all([doc.fonts.ready, ...Array.from(doc.fonts, face => face.load()), ...images]).then(() => {
        if (finished) return;
        try {
          if (readinessTimer !== undefined) clearTimer(readinessTimer);
          readinessTimer = undefined;
          prepared = true;
          // Resolve only after the frame has its complete enhanced body and fonts.
          resolveReady();
        } catch (error) { finish('failed', error); }
      }, error => finish('failed', error));
    } catch (error) { finish('failed', error); throw error; }
    return lease;
  }
  return Object.freeze({ mount, destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const lease of [...leases]) lease.release();
  } });
}
