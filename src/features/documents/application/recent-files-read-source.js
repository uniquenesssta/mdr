/**
 * Responsibility: Expose RecentFilesRepository snapshots as a read-only cross-feature source.
 * Imports: None; Menu, DOM, storage and platform dependencies are forbidden.
 * Exports: createRecentFilesReadSource().
 * State/side effects: Owns no data; delegates snapshot reads and subscriptions only.
 * Lifecycle: Pure adapter. Returned unsubscribe callbacks are idempotent and owned by callers.
 */
export function createRecentFilesReadSource(repository) {
  if (!repository || typeof repository !== 'object' || typeof repository.subscribe !== 'function') {
    throw new TypeError('Recent files read source requires a subscribable repository.');
  }

  return Object.freeze({
    get snapshot() {
      return repository.snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Recent files read listener must be a function.');
      const dispose = repository.subscribe(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        dispose?.();
      };
    }
  });
}
