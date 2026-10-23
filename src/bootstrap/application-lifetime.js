/**
 * Responsibility: Release application registrations, timers and listeners, including partial construction.
 * Imports: Explicit caller capabilities and application lifetime management.
 * Exports: createApplicationLifetime.
 * State/side effects: Owns only this feature's projections, listeners and pending UI work.
 * Lifecycle: Explicit construction, rollback on failure and idempotent destroy.
 */
export function createApplicationLifetime({ timers = globalThis } = {}) {
  let alive = true;
  const releases = [], pending = new Set();
  function own(release) { if (typeof release === 'function') { if (alive) releases.push(release); else release(); } return release; }
  function destroy() {
    if (!alive) return;
    alive = false;
    const errors = [];
    for (const id of pending) { try { timers.clearTimeout(id); } catch (error) { errors.push(error); } }
    pending.clear();
    for (const release of releases.reverse()) { try { release(); } catch (error) { errors.push(error); } }
    releases.length = 0;
    if (errors.length) throw new AggregateError(errors, 'Application cleanup failed.');
  }
  return Object.freeze({
    get alive() { return alive; }, own, destroy,
    listen(target, type, listener, options) {
      if (!target || !alive) throw new Error('Application listener target/lifetime is unavailable.');
      const guarded = (...args) => { if (alive) return listener(...args); };
      own(() => target.removeEventListener(type, guarded, options));
      target.addEventListener(type, guarded, options);
    },
    setTimeout(callback, delay) {
      if (!alive) return 0;
      const id = timers.setTimeout(() => { pending.delete(id); if (alive) callback(); }, delay);
      pending.add(id); return id;
    },
    clearTimeout(id) { pending.delete(id); timers.clearTimeout(id); }
  });
}
