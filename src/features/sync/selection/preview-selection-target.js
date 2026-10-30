/**
 * Responsibility: Retain a document-scoped reading bookmark and reveal its real
 * editor target only while that surface is visible; measure stable frame latency.
 * State/side effects: One bookmark and cancellable frame. No DOM selection, model
 * mapping, preview rendering or focus ownership. Destroy cancels all continuation.
 */
export function createPreviewSelectionTarget({ editorApi, setSelection, editorMapper, scrollController,
  isVisible, getIdentity, requestFrame, cancelFrame, now, record }) {
  let bookmark = null, intent = null, frame = 0, generation = 0, destroyed = false;
  const stats = { previewEditorWrites: 0, deferredPreviewSelections: 0, previewRevealsCompleted: 0, previewRevealTimeouts: 0, lastPreviewRevealDurationMs: null };
  const current = value => !destroyed && value?.identity === getIdentity();
  function cancel({ forget = false } = {}) {
    generation++;
    if (frame) cancelFrame(frame);
    frame = 0; intent = null;
    if (forget) bookmark = null;
  }
  function reveal(value) {
    if (!current(value) || !isVisible()) return null;
    const metrics = editorApi.getScrollMetrics();
    const viewport = editorApi.getScrollViewportRect?.();
    const a = editorApi.getPositionCoordinates?.(value.start);
    const b = editorApi.getPositionCoordinates?.(Math.max(value.start, value.end - 1));
    if (!viewport || !a || !b) {
      const y = editorMapper.getContentYForPosition(value.start);
      scrollController.scrollTo('editor', y - metrics.clientHeight * 0.5,
        { behavior: 'auto', reason: 'selection-preview-to-editor', suspendMs: 180, settleMs: 700 });
      return null;
    }
    const top = Math.min(a.top, b.top), bottom = Math.max(a.bottom, b.bottom);
    const height = metrics.clientHeight;
    const oversized = bottom - top > height - 16;
    const visible = oversized ? bottom > viewport.top && top < viewport.bottom
      : top >= viewport.top - 1 && bottom <= viewport.bottom + 1;
    if (!visible) {
      const delta = top < viewport.top || oversized ? top - viewport.top - 8 : bottom - viewport.bottom + 8;
      scrollController.scrollTo('editor', metrics.top + delta,
        { behavior: 'auto', reason: 'selection-preview-to-editor', suspendMs: 180, settleMs: 700 });
      return null;
    }
    return [top, bottom, metrics.top];
  }
  function settle(value, token) {
    if (token !== generation || intent !== value || !current(value) || !isVisible()) return;
    const position = reveal(value);
    const stable = position && value.previous && position.every((n, i) => Math.abs(n - value.previous[i]) <= 1);
    value.stable = stable ? value.stable + 1 : 0;
    value.previous = position;
    if (value.stable >= 3) {
      intent = null;
      if (value.startedAt !== null) {
        const durationMs = Math.max(0, now() - value.startedAt);
        stats.previewRevealsCompleted++;
        stats.lastPreviewRevealDurationMs = durationMs;
        record('selection.reveal-latency', { category: 'sync.selection', durationMs,
          details: { direction: 'preview-to-editor', stableFrames: value.stable } });
      }
      return;
    }
    if (++value.checks <= 30) frame = requestFrame(() => { frame = 0; settle(value, token); });
    else {
      stats.previewRevealTimeouts++;
      record('selection.reveal-latency', { category: 'sync.selection', status: 'warning',
        durationMs: value.startedAt === null ? undefined : Math.max(0, now() - value.startedAt),
        details: { direction: 'preview-to-editor', stableFrames: value.stable, completed: false } });
      intent = null;
    }
  }
  function apply(value) {
    cancel();
    if (!current(value) || !isVisible()) return false;
    bookmark = null;
    const selection = editorApi.getSelection();
    if (selection.start !== value.start || selection.end !== value.end) {
      setSelection(value.start, value.end);
      stats.previewEditorWrites++;
    }
    intent = { ...value, stable: 0, checks: 0, previous: null };
    settle(intent, generation);
    return true;
  }
  return Object.freeze({
    select(start, end, startedAt = null) {
      cancel({ forget: true });
      if (destroyed) return false;
      const value = { start, end, startedAt, identity: getIdentity() };
      if (isVisible()) return apply(value);
      bookmark = value; stats.deferredPreviewSelections++;
      return false;
    },
    layoutChanged() {
      if (!bookmark || destroyed) return;
      if (!current(bookmark)) { cancel({ forget: true }); return; }
      if (frame) cancelFrame(frame);
      const token = ++generation;
      frame = requestFrame(() => {
        frame = 0;
        if (token === generation && current(bookmark) && isVisible()) apply({ ...bookmark, startedAt: null });
      });
    },
    cancel,
    getState: () => ({ ...stats, hasReadingBookmark: current(bookmark) }),
    destroy() { cancel({ forget: true }); destroyed = true; }
  });
}
