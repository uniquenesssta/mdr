/**
 * Responsibility: Expose only RecentFilesRepository write commands still needed by classic document-open flows.
 * State/side effects: Owns one host property lifecycle only; recent-file state, reads, subscriptions and persistence remain owned by Documents.
 */
const PORT_NAME = 'markdownEditorRecentFilesPort';

export function mountClassicRecentFilesPort(host, repository) {
  if (!host || typeof host !== 'object') throw new TypeError('Recent files compatibility host is required.');
  if (!repository || typeof repository.add !== 'function' || typeof repository.clear !== 'function') {
    throw new TypeError('Recent files repository is required.');
  }
  if (host[PORT_NAME]) throw new Error('Recent files compatibility port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Recent files compatibility port has been destroyed.');
  };
  const call = method => (...args) => {
    assertActive();
    return repository[method](...args);
  };

  const api = Object.freeze({
    add: call('add'),
    clear: call('clear'),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_NAME] === api) delete host[PORT_NAME];
    }
  });

  host[PORT_NAME] = api;
  return api;
}
