const PORT_PROPERTY = 'markdownEditorI18nPort';

function assertMountTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('Classic I18n port target must be an object.');
  }
}

function assertService(service) {
  if (
    !service
    || typeof service.t !== 'function'
    || typeof service.setLocale !== 'function'
    || typeof service.subscribe !== 'function'
  ) {
    throw new TypeError('Classic I18n port requires an I18n service.');
  }
}

export function mountClassicI18nPort(target, service) {
  assertMountTarget(target);
  assertService(service);
  if (Object.hasOwn(target, PORT_PROPERTY)) throw new Error('Classic I18n port is already mounted.');

  let destroyed = false;
  const subscriptions = new Set();
  const assertActive = () => {
    if (destroyed) throw new Error('Classic I18n port is destroyed.');
  };

  const api = Object.freeze({
    get locale() {
      assertActive();
      return service.locale;
    },

    defaultLocale: service.defaultLocale,

    t(key, ...args) {
      assertActive();
      return service.t(key, ...args);
    },

    setLocale(locale) {
      assertActive();
      return service.setLocale(locale);
    },

    subscribe(listener) {
      assertActive();
      const disposeServiceSubscription = service.subscribe(listener);
      let active = true;
      const dispose = () => {
        if (!active) return;
        active = false;
        subscriptions.delete(dispose);
        disposeServiceSubscription();
      };
      subscriptions.add(dispose);
      return dispose;
    }
  });

  Object.defineProperty(target, PORT_PROPERTY, {
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
      for (const dispose of [...subscriptions].reverse()) dispose();
      if (target[PORT_PROPERTY] === api) delete target[PORT_PROPERTY];
      if (typeof target.removeAttribute === 'function') target.removeAttribute(PORT_PROPERTY);
    }
  });
}
