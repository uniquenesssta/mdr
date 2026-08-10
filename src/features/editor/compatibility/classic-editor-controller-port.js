/**
 * Responsibility: Expose the Stage 5.8 Editor Controller to remaining classic callers through the scoped compatibility host.
 * State/side effects: Owns one host property lifecycle only; editor text and transaction authority remain in the injected Controller/DocumentModel.
 */
const PORT_NAME = 'markdownEditorEditorControllerPort';

export function mountClassicEditorControllerPort(host, controller) {
  if (!host || typeof host !== 'object') throw new TypeError('Editor Controller compatibility host is required.');
  if (!controller || typeof controller.subscribeTransactions !== 'function' || typeof controller.setText !== 'function') {
    throw new TypeError('Editor Controller is required.');
  }
  if (host[PORT_NAME]) throw new Error('Editor Controller compatibility port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Editor Controller compatibility port has been destroyed.');
  };
  const call = method => (...args) => {
    assertActive();
    return controller[method](...args);
  };

  const api = Object.freeze({
    get state() { assertActive(); return controller.state; },
    subscribeTransactions: call('subscribeTransactions'),
    setText: call('setText'),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_NAME] === api) delete host[PORT_NAME];
    }
  });

  host[PORT_NAME] = api;
  return api;
}
