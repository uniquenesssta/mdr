/**
 * Responsibility: Apply committed Settings language changes to the I18n Service through the public SettingsChanged contract.
 * Imports: None; I18n Service, Settings event target and event type are injected by the composition root.
 * Exports: createSettingsLocaleController().
 * State/side effects: Owns one committed-Settings listener lifecycle; owns no locale value, persistence, DOM text or translation data.
 */

function requireI18n(i18n) {
  if (!i18n || typeof i18n.setLocale !== 'function') {
    throw new TypeError('Settings Locale Controller requires an I18n Service.');
  }
  return i18n;
}

function requireEventTarget(target) {
  if (!target
    || typeof target.addEventListener !== 'function'
    || typeof target.removeEventListener !== 'function') {
    throw new TypeError('Settings Locale Controller requires a Settings event target.');
  }
  return target;
}

function requireEventType(eventType) {
  if (typeof eventType !== 'string' || !eventType.trim()) {
    throw new TypeError('Settings Locale Controller requires a Settings event type.');
  }
  return eventType;
}

function localeFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('Settings Locale Controller requires a committed Settings snapshot.');
  }
  return snapshot.language;
}

export function createSettingsLocaleController({ i18n, eventTarget, eventType } = {}) {
  const service = requireI18n(i18n);
  const settingsEvents = requireEventTarget(eventTarget);
  const settingsChangedEvent = requireEventType(eventType);
  let listenerInstalled = false;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Settings Locale Controller is destroyed.');
  };

  function applySnapshot(snapshot) {
    assertActive();
    return service.setLocale(localeFromSnapshot(snapshot));
  }

  function handleSettingsChanged(event) {
    if (destroyed) return;
    const detail = event?.detail;
    if (!detail || !Array.isArray(detail.changedIds) || !detail.changedIds.includes('language')) return;
    applySnapshot(detail.snapshot);
  }

  try {
    listenerInstalled = true;
    settingsEvents.addEventListener(settingsChangedEvent, handleSettingsChanged);
  } catch (error) {
    const errors = [error];
    if (listenerInstalled) {
      try { settingsEvents.removeEventListener(settingsChangedEvent, handleSettingsChanged); }
      catch (cleanupError) { errors.push(cleanupError); }
    }
    destroyed = true;
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Settings Locale Controller construction failed and cleanup was incomplete.');
  }

  return Object.freeze({
    applySnapshot,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (!listenerInstalled) return;
      listenerInstalled = false;
      try {
        settingsEvents.removeEventListener(settingsChangedEvent, handleSettingsChanged);
      } catch (error) {
        throw new AggregateError([error], 'Settings Locale Controller cleanup failed.');
      }
    }
  });
}
