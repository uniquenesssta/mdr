/**
 * Responsibility: Temporary scoped bridge from remaining classic startup code to the Help Controller public contract.
 * Imports: None; controller is injected and raw Help internals are not exposed.
 * Exports: mountClassicHelpPort().
 * State/side effects: Owns one non-enumerable property on the compatibility host. Lifecycle: explicit destroyable mount.
 */
const HELP_PORT_PROPERTY = 'markdownEditorHelpPort';

function assertHost(host) {
  if (!host || typeof host !== 'object' || typeof host.removeAttribute !== 'function') {
    throw new TypeError('Classic Help port requires the compatibility host element.');
  }
}

function assertController(controller) {
  const methods = ['open', 'close', 'navigate', 'openFirstRun', 'isOpen'];
  if (!controller || methods.some(method => typeof controller[method] !== 'function')) {
    throw new TypeError('Classic Help port requires a Help controller.');
  }
}

export function mountClassicHelpPort(host, controller) {
  assertHost(host);
  assertController(controller);
  if (Object.hasOwn(host, HELP_PORT_PROPERTY)) throw new Error('Classic Help port is already mounted.');
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Classic Help port is destroyed.');
  };

  const api = Object.freeze({
    get activePage() {
      assertActive();
      return controller.activePage;
    },
    open(page) {
      assertActive();
      return controller.open(page);
    },
    close(reason) {
      assertActive();
      return controller.close(reason);
    },
    navigate(page) {
      assertActive();
      return controller.navigate(page);
    },
    openFirstRun() {
      assertActive();
      return controller.openFirstRun();
    },
    isOpen() {
      assertActive();
      return controller.isOpen();
    }
  });

  Object.defineProperty(host, HELP_PORT_PROPERTY, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api
  });

  return Object.freeze({
    api,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[HELP_PORT_PROPERTY] === api) delete host[HELP_PORT_PROPERTY];
    }
  });
}
