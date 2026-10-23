/** Observe the frozen model at its composition boundary; never alter its algorithm or journal. */
export function observeDocumentSnapshots(model, { record, now }) {
  const previous = Object.getOwnPropertyDescriptor(model, 'createSnapshot');
  const snapshot = model.createSnapshot;
  const observed = function (reason = 'explicit') {
    const start = now();
    const value = snapshot.call(this, reason);
    record('document.snapshot', { category: 'document.model', durationMs: now() - start, aggregate: true,
      details: { reason: String(reason || 'explicit'), documentId: this.documentId,
        generation: this.generation, version: this.version, chars: value.length } });
    return value;
  };
  Object.defineProperty(model, 'createSnapshot', { configurable: true, writable: true, value: observed });
  return () => {
    if (model.createSnapshot !== observed) return;
    if (previous) Object.defineProperty(model, 'createSnapshot', previous);
    else delete model.createSnapshot;
  };
}
