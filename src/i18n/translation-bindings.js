const VIEW_NAMES = Object.freeze(['menu', 'toolbar', 'sidebar', 'editor', 'preview', 'status', 'overlay']);
const BINDING_DEFINITIONS = Object.freeze([
  Object.freeze({ datasetKey: 'i18n', kind: 'text' }),
  Object.freeze({ datasetKey: 'i18nTitle', kind: 'title' }),
  Object.freeze({ datasetKey: 'i18nPlaceholder', kind: 'placeholder' }),
  Object.freeze({ datasetKey: 'i18nAlt', kind: 'alt' }),
  Object.freeze({ datasetKey: 'i18nAriaLabel', kind: 'aria-label' })
]);
const BINDING_SELECTOR = '[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-alt], [data-i18n-aria-label]';

function assertI18nService(i18n) {
  if (
    !i18n
    || typeof i18n.t !== 'function'
    || typeof i18n.subscribe !== 'function'
    || typeof i18n.locale !== 'string'
  ) {
    throw new TypeError('Translation bindings require an active I18n service.');
  }
}

function assertViewRoot(view, name, documentElement) {
  if (!view || typeof view.querySelectorAll !== 'function') {
    throw new TypeError(`Translation bindings require the ${name} View root.`);
  }
  if (view.ownerDocument?.documentElement && view.ownerDocument.documentElement !== documentElement) {
    throw new TypeError(`Translation bindings ${name} View belongs to another document.`);
  }
}

function collectBindings(views, documentElement) {
  if (!views || typeof views !== 'object' || Array.isArray(views)) {
    throw new TypeError('Translation bindings require named View roots.');
  }

  const bindings = [];
  for (const name of VIEW_NAMES) {
    const view = views[name];
    assertViewRoot(view, name, documentElement);
    const elements = [
      ...(view.matches?.(BINDING_SELECTOR) ? [view] : []),
      ...view.querySelectorAll(BINDING_SELECTOR)
    ];
    for (const element of elements) {
      for (const definition of BINDING_DEFINITIONS) {
        const key = String(element?.dataset?.[definition.datasetKey] || '').trim();
        if (!key) continue;
        bindings.push(Object.freeze({ view: name, element, kind: definition.kind, key }));
      }
    }
  }
  return bindings;
}

function applyBinding(binding, value) {
  switch (binding.kind) {
    case 'text':
      binding.element.textContent = value;
      break;
    case 'title':
      binding.element.title = value;
      break;
    case 'placeholder':
      binding.element.placeholder = value;
      break;
    case 'alt':
      binding.element.alt = value;
      break;
    case 'aria-label':
      binding.element.setAttribute('aria-label', value);
      break;
    default:
      throw new Error(`Unsupported translation binding kind: ${binding.kind}`);
  }
}

export function createTranslationBindings(i18n, views, { documentElement = views?.menu?.ownerDocument?.documentElement } = {}) {
  assertI18nService(i18n);
  if (!documentElement || typeof documentElement.setAttribute !== 'function') {
    throw new TypeError('Translation bindings require a document element.');
  }

  const bindings = collectBindings(views, documentElement);
  let destroyed = false;
  let disposeLocaleSubscription = null;

  const assertActive = () => {
    if (destroyed) throw new Error('Translation bindings are destroyed.');
  };

  function refresh() {
    assertActive();
    const errors = [];
    try {
      documentElement.setAttribute('lang', i18n.locale);
    } catch (error) {
      errors.push(error);
    }
    for (const binding of bindings) {
      try {
        applyBinding(binding, i18n.t(binding.key));
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Translation binding refresh failed.');
    return bindings.length;
  }

  refresh();
  disposeLocaleSubscription = i18n.subscribe(() => refresh());

  return Object.freeze({
    get bindingCount() {
      assertActive();
      return bindings.length;
    },
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const dispose = disposeLocaleSubscription;
      disposeLocaleSubscription = null;
      bindings.length = 0;
      dispose?.();
    }
  });
}
