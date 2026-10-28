/** Drain acknowledged native launches through real document import commands, in arrival order. */
export function createLaunchOpenController({ launch, openPath, reportError }) {
  let alive = true, running = null, dirty = false, unsubscribe = null;
  async function drain() {
    dirty = true;
    if (running) return running;
    running = (async () => {
      do {
        dirty = false;
        while (alive) {
          const request = await launch.peek();
          if (!alive || !request) break;
          for (const path of request.paths) {
            if (!alive) return;
            try { await openPath(path); } catch (error) { reportError(error); }
          }
          if (!alive) return;
          await launch.acknowledge(request.id);
        }
      } while (alive && dirty);
    })().finally(() => { running = null; });
    return running;
  }
  return Object.freeze({
    async start() {
      const release = await launch.subscribe(() => { void drain().catch(reportError); });
      if (!alive) { await release(); return; }
      unsubscribe = release;
      await drain();
    },
    destroy() { alive = false; const release = unsubscribe; unsubscribe = null; return release?.(); }
  });
}
