/**
 * Responsibility: Virtual preview block-height estimation, measured heights and persisted cache.
 * Imports: None.
 * Exports: createVirtualHeightCache and estimateVirtualBlockHeight.
 * State/side effects: Owns height/inset maps and storage persistence through injected capabilities.
 * Lifecycle: setContext/schedulePersist/persist/destroy.
 */

const HEIGHT_CACHE_PREFIX = 'md_editor_preview_heights_v1:';
const HEIGHT_CACHE_LIMIT = 4000;
const HEIGHT_CACHE_VERSION = 1;

function simpleHash(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function blockHeightSignature(block) {
  const raw = String(block?.raw || '');
  const lines = Math.max(1, (block?.endLine || block?.startLine || 1) - (block?.startLine || 1) + 1);
  const sample = raw.length <= 160 ? raw : raw.slice(0, 80) + raw.slice(-80);
  return `${block?.type || 'unknown'}:${lines}:${raw.length}:${simpleHash(sample)}`;
}

export function estimateVirtualBlockHeight(block) {
  const lines = Math.max(1, (block?.endLine || block?.startLine || 1) - (block?.startLine || 1) + 1);
  switch (block?.type) {
    case 'heading': return 58;
    case 'code': return Math.min(1200, 42 + lines * 25);
    case 'blockquote': return Math.min(800, 28 + lines * 28);
    case 'list': return Math.min(1000, 18 + lines * 31);
    case 'table': return Math.min(1200, 48 + lines * 39);
    case 'hr': return 34;
    case 'html': return Math.min(1000, 24 + lines * 28);
    default: return Math.min(700, 16 + lines * 29);
  }
}

export function createVirtualHeightCache({
  storage = null,
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
  cancelTimer = handle => clearTimeout(handle),
  scheduleIdle = callback => callback(),
  cancelIdle = () => {},
  now = () => Date.now(),
  reportError = () => {}
} = {}) {
  let heightById = new Map();
  let insetById = new Map();
  let cachedEntries = new Map();
  let documentId = '';
  let visualKey = '';
  let storageKey = '';
  let persistTimer = 0;
  let blocks = [];
  let destroyed = false;

  function assertAlive() {
    if (destroyed) throw new Error('Virtual height cache is destroyed.');
  }

  function setBlocks(nextBlocks) {
    assertAlive();
    blocks = Array.isArray(nextBlocks) ? nextBlocks : [];
  }

  function persist() {
    if (destroyed) return;
    if (persistTimer) cancelTimer(persistTimer);
    persistTimer = 0;
    if (!storageKey || !heightById.size || !blocks.length || !storage?.setItem) return;
    const blockById = new Map(blocks.map(block => [block.id, block]));
    const merged = new Map(cachedEntries);
    for (const [id, height] of heightById) {
      const block = blockById.get(id);
      if (!block) continue;
      const inset = insetById.get(id) || { top: 0, bottom: 0 };
      merged.delete(id);
      merged.set(id, {
        signature: blockHeightSignature(block),
        height: Math.round(height * 10) / 10,
        inset: { top: inset.top || 0, bottom: inset.bottom || 0 }
      });
    }
    const selected = [...merged.entries()].slice(-HEIGHT_CACHE_LIMIT);
    cachedEntries = new Map(selected);
    const entries = selected.map(([id, item]) => [
      id,
      item.signature,
      item.height,
      item.inset?.top || 0,
      item.inset?.bottom || 0
    ]);
    try {
      storage.setItem(storageKey, JSON.stringify({
        version: HEIGHT_CACHE_VERSION,
        visualKey,
        updatedAt: now(),
        entries
      }));
    } catch (error) {
      reportError('Preview height cache skipped:', error);
    }
  }

  function schedulePersist() {
    assertAlive();
    if (!storageKey) return;
    if (persistTimer) cancelTimer(persistTimer);
    persistTimer = scheduleTimer(() => {
      persistTimer = 0;
      scheduleIdle(() => persist());
    }, 900);
  }

  function setContext(nextDocumentId, nextVisualKey = '') {
    assertAlive();
    const normalizedDocumentId = String(nextDocumentId || 'anonymous');
    const normalizedVisualKey = String(nextVisualKey || 'default');
    if (normalizedDocumentId === documentId && normalizedVisualKey === visualKey) return false;
    persist();
    documentId = normalizedDocumentId;
    visualKey = normalizedVisualKey;
    storageKey = HEIGHT_CACHE_PREFIX + encodeURIComponent(normalizedDocumentId);
    heightById = new Map();
    insetById = new Map();
    cachedEntries = new Map();
    if (!storage?.getItem) return true;
    try {
      const parsed = JSON.parse(storage.getItem(storageKey) || 'null');
      if (!parsed || parsed.version !== HEIGHT_CACHE_VERSION || parsed.visualKey !== normalizedVisualKey || !Array.isArray(parsed.entries)) return true;
      for (const item of parsed.entries) {
        if (!Array.isArray(item) || item.length < 4) continue;
        const [id, signature, height, top = 0, bottom = 0] = item;
        const numericHeight = Number(height);
        if (!id || !signature || !Number.isFinite(numericHeight) || numericHeight < 18) continue;
        cachedEntries.set(String(id), {
          signature: String(signature),
          height: numericHeight,
          inset: { top: Number(top) || 0, bottom: Number(bottom) || 0 }
        });
      }
    } catch (_) {
      cachedEntries.clear();
    }
    return true;
  }

  function restore(nextBlocks = blocks) {
    assertAlive();
    let restored = 0;
    for (const block of nextBlocks || []) {
      if (heightById.has(block.id)) continue;
      const cached = cachedEntries.get(block.id);
      if (!cached || cached.signature !== blockHeightSignature(block)) continue;
      heightById.set(block.id, cached.height);
      insetById.set(block.id, cached.inset);
      restored += 1;
    }
    return restored;
  }

  function recordMeasurement(id, height, inset = {}) {
    assertAlive();
    const numericHeight = Math.max(18, Number(height) || 0);
    const previous = heightById.get(id) || 0;
    if (Math.abs(previous - numericHeight) < 1) return false;
    heightById.delete(id);
    heightById.set(id, numericHeight);
    insetById.set(id, { top: Number(inset.top) || 0, bottom: Number(inset.bottom) || 0 });
    return true;
  }

  function remove(id) {
    assertAlive();
    heightById.delete(id);
    insetById.delete(id);
  }

  function retainIds(ids) {
    assertAlive();
    const keep = ids instanceof Set ? ids : new Set(ids || []);
    for (const id of [...heightById.keys()]) if (!keep.has(id)) heightById.delete(id);
    for (const id of [...insetById.keys()]) if (!keep.has(id)) insetById.delete(id);
  }

  function getHeight(block) {
    assertAlive();
    return heightById.get(block?.id) || estimateVirtualBlockHeight(block);
  }

  function getInset(id) {
    assertAlive();
    return insetById.get(id) || { top: 0, bottom: 0 };
  }

  function destroy() {
    if (destroyed) return;
    persist();
    destroyed = true;
    if (persistTimer) cancelTimer(persistTimer);
    persistTimer = 0;
    cancelIdle();
    blocks = [];
  }

  return Object.freeze({
    setBlocks,
    setContext,
    restore,
    recordMeasurement,
    remove,
    retainIds,
    getHeight,
    getInset,
    schedulePersist,
    persist,
    destroy,
    get measuredCount() { return heightById.size; },
    get cachedCount() { return cachedEntries.size; },
    get context() { return Object.freeze({ documentId, visualKey, storageKey }); }
  });
}
