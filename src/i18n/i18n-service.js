/**
 * Responsibility: Own the active locale, translation lookup, placeholder formatting, fallback and locale-change subscriptions.
 * Imports: Locale registry contract is injected; DOM, Settings persistence and platform APIs are forbidden.
 * Exports: createI18nService().
 * State/side effects: Owns only locale state and listener membership; it performs no DOM or storage writes.
 * Lifecycle: Explicit destroyable service; destroy clears listeners and makes stateful operations terminal.
 */
function assertRegistry(registry) {
  if (
    !registry
    || typeof registry.has !== 'function'
    || typeof registry.get !== 'function'
    || typeof registry.defaultLocale !== 'string'
  ) {
    throw new TypeError('I18n service requires a locale registry.');
  }
}

function formatTranslation(value, args) {
  return args.reduce(
    (text, arg, index) => text.replace(new RegExp(`\\{${index}\\}`, 'g'), String(arg)),
    String(value)
  );
}

export function createI18nService(registry, { initialLocale = registry?.defaultLocale } = {}) {
  assertRegistry(registry);

  const defaultLocale = registry.defaultLocale;
  let locale = registry.has(initialLocale) ? initialLocale : defaultLocale;
  let destroyed = false;
  const listeners = new Set();

  const assertActive = () => {
    if (destroyed) throw new Error('I18n service is destroyed.');
  };

  const service = {
    get locale() {
      assertActive();
      return locale;
    },

    defaultLocale,

    t(key, ...args) {
      assertActive();
      const translationKey = String(key);
      const selected = registry.get(locale);
      const fallback = registry.get(defaultLocale);
      const value = selected?.[translationKey] ?? fallback?.[translationKey] ?? translationKey;
      return formatTranslation(value, args);
    },

    setLocale(nextLocale) {
      assertActive();
      const resolvedLocale = registry.has(nextLocale) ? nextLocale : defaultLocale;
      if (resolvedLocale === locale) return resolvedLocale;

      const previousLocale = locale;
      locale = resolvedLocale;
      const event = Object.freeze({ locale: resolvedLocale, previousLocale });
      const errors = [];
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'I18n locale listeners failed.');
      return resolvedLocale;
    },

    subscribe(listener) {
      assertActive();
      if (typeof listener !== 'function') throw new TypeError('I18n locale listener must be a function.');
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
    }
  };

  return Object.freeze(service);
}
