/**
 * Responsibility: Measure pointer delivery through the next selection paint
 * opportunity without reading text, geometry or changing native selection.
 * State/side effects: One frame and one bounded gesture summary; emits numeric
 * metrics only at release. Stop/destroy remove all listeners and pending work.
 */
export function createSelectionDragObserver({ editor, preview, documentRef, requestFrame, cancelFrame, now, record }) {
  let gesture = null, frame = 0, started = false, destroyed = false;
  let last = null;
  function cancel() { if (frame) cancelFrame(frame); frame = 0; gesture = null; }
  function down(event) {
    cancel();
    if (event.button !== 0) return;
    const side = editor.contains(event.target) ? 'editor' : preview.contains(event.target) ? 'preview' : '';
    if (side) gesture = { side, samples: 0, maxDelay: 0, maxQueue: 0, maxFrame: 0, previousFrame: null, movedAt: null };
  }
  function move(event) {
    if (!gesture || !(event.buttons & 1)) return;
    const received = now(), timestamp = Number(event.timeStamp);
    const input = Number.isFinite(timestamp) && timestamp >= 0 && Math.abs(received - timestamp) < 60000 ? timestamp : received;
    // Keep the oldest event coalesced into this frame, not just the latest move.
    gesture.movedAt ??= input;
    gesture.maxQueue = Math.max(gesture.maxQueue, received - input);
    if (frame) return;
    frame = requestFrame(() => {
      frame = 0;
      if (!gesture) return;
      const painted = now();
      gesture.maxDelay = Math.max(gesture.maxDelay, painted - gesture.movedAt);
      if (gesture.previousFrame !== null) gesture.maxFrame = Math.max(gesture.maxFrame, painted - gesture.previousFrame);
      gesture.previousFrame = painted; gesture.movedAt = null; gesture.samples++;
    });
  }
  function end() {
    if (!gesture) return;
    if (gesture.samples) {
      last = { side: gesture.side, samples: gesture.samples, maxQueueMs: Math.max(0, gesture.maxQueue),
        maxFrameIntervalMs: gesture.maxFrame, pointerToFrameMs: Math.max(0, gesture.maxDelay) };
      record('selection.drag-frame-latency', { category: 'sync.selection', durationMs: last.pointerToFrameMs, details: last });
    }
    cancel();
  }
  return Object.freeze({
    start() {
      if (destroyed || started) return;
      started = true;
      documentRef.addEventListener('pointerdown', down, true);
      documentRef.addEventListener('pointermove', move, { capture: true, passive: true });
      documentRef.addEventListener('pointerup', end, true);
      documentRef.addEventListener('pointercancel', cancel, true);
    },
    stop() {
      cancel();
      if (!started) return;
      started = false;
      documentRef.removeEventListener('pointerdown', down, true);
      documentRef.removeEventListener('pointermove', move, { capture: true });
      documentRef.removeEventListener('pointerup', end, true);
      documentRef.removeEventListener('pointercancel', cancel, true);
    },
    getState: () => last && { ...last },
    destroy() { this.stop(); destroyed = true; }
  });
}
