/**
 * Responsibility: Apply the validated committed Settings theme to one explicit DOM root and follow the public SettingsChanged event without rebuilding application surfaces.
 * Imports: Public Settings validation/event contracts only.
 * Exports: createThemeService().
 * State/side effects: Owns current applied theme plus one SettingsChanged listener; mutates only the root data-theme attribute and restores the pre-service attribute on destroy.
 */
import {
  SETTINGS_CHANGED_EVENT,
  getSettingDefinition,
  normalizeSettingValue
} from '../features/settings/index.js';

const THEME_SETTING = getSettingDefinition('theme');
if (!THEME_SETTING) throw new Error('Theme setting definition is unavailable.');

function requireThemeRoot(root) {
  if (!root
    || typeof root.getAttribute !== 'function'
    || typeof root.setAttribute !== 'function'
    || typeof root.removeAttribute !== 'function') {
    throw new TypeError('Theme Service requires an attribute-capable theme root.');
  }
  return root;
}

function requireEventTarget(target) {
  if (!target
    || typeof target.addEventListener !== 'function'
    || typeof target.removeEventListener !== 'function') {
    throw new TypeError('Theme Service requires a Settings event target.');
  }
  return target;
}

function themeFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('Theme Service requires a Settings snapshot.');
  }
  return normalizeSettingValue(THEME_SETTING, snapshot.theme);
}

export function createThemeService({ root, eventTarget = root?.ownerDocument, initialSnapshot } = {}) {
  const themeRoot = requireThemeRoot(root);
  const settingsEvents = requireEventTarget(eventTarget);
  const hadOriginalTheme = themeRoot.getAttribute('data-theme') !== null;
  const originalTheme = themeRoot.getAttribute('data-theme');
  let currentTheme = null;
  let listenerInstalled = false;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Theme Service is destroyed.');
  };

  const restoreOriginalTheme = () => {
    if (hadOriginalTheme) themeRoot.setAttribute('data-theme', originalTheme);
    else themeRoot.removeAttribute('data-theme');
  };

  function applySnapshot(snapshot) {
    assertActive();
    const nextTheme = themeFromSnapshot(snapshot);
    if (currentTheme === nextTheme && themeRoot.getAttribute('data-theme') === nextTheme) return false;
    themeRoot.setAttribute('data-theme', nextTheme);
    currentTheme = nextTheme;
    return true;
  }

  function handleSettingsChanged(event) {
    if (destroyed) return;
    const detail = event?.detail;
    if (!detail || !Array.isArray(detail.changedIds) || !detail.changedIds.includes('theme')) return;
    applySnapshot(detail.snapshot);
  }

  try {
    applySnapshot(initialSnapshot);
    listenerInstalled = true;
    settingsEvents.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged);
  } catch (error) {
    const errors = [error];
    if (listenerInstalled) {
      try { settingsEvents.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged); }
      catch (cleanupError) { errors.push(cleanupError); }
    }
    try { restoreOriginalTheme(); }
    catch (cleanupError) { errors.push(cleanupError); }
    destroyed = true;
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Theme Service construction failed and cleanup was incomplete.');
  }

  return Object.freeze({
    get theme() {
      assertActive();
      return currentTheme;
    },
    applySnapshot,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors = [];
      if (listenerInstalled) {
        listenerInstalled = false;
        try { settingsEvents.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged); }
        catch (error) { errors.push(error); }
      }
      try { restoreOriginalTheme(); }
      catch (error) { errors.push(error); }
      currentTheme = null;
      if (errors.length) throw new AggregateError(errors, 'Theme Service cleanup failed.');
    }
  });
}
