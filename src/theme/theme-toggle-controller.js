/**
 * Responsibility: Bind the explicit theme toggle control to a committed Settings command without applying theme DOM state itself.
 * Imports: Public Settings validation metadata only.
 * Exports: createThemeToggleController().
 * State/side effects: Owns one click listener; reads committed theme through an injected getter and submits the next validated theme through an injected commit command.
 */
import { getSettingDefinition, normalizeSettingValue } from '../features/settings/index.js';

const THEME_SETTING = getSettingDefinition('theme');
if (!THEME_SETTING) throw new Error('Theme setting definition is unavailable.');
const THEME_VALUES = THEME_SETTING.validation.values;

function requireTrigger(trigger) {
  if (!trigger
    || typeof trigger.addEventListener !== 'function'
    || typeof trigger.removeEventListener !== 'function') {
    throw new TypeError('Theme Toggle Controller requires an event-capable trigger.');
  }
  return trigger;
}

export function createThemeToggleController({ trigger, readTheme, commitTheme } = {}) {
  const themeTrigger = requireTrigger(trigger);
  if (typeof readTheme !== 'function') throw new TypeError('Theme Toggle Controller requires readTheme().');
  if (typeof commitTheme !== 'function') throw new TypeError('Theme Toggle Controller requires commitTheme().');

  let listenerInstalled = false;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Theme Toggle Controller is destroyed.');
  };

  function toggle() {
    assertActive();
    const current = normalizeSettingValue(THEME_SETTING, readTheme());
    const index = THEME_VALUES.indexOf(current);
    const nextTheme = THEME_VALUES[(index + 1) % THEME_VALUES.length];
    return commitTheme(nextTheme);
  }

  const handleClick = () => toggle();

  try {
    listenerInstalled = true;
    themeTrigger.addEventListener('click', handleClick);
  } catch (error) {
    const errors = [error];
    if (listenerInstalled) {
      try {
        themeTrigger.removeEventListener('click', handleClick);
        listenerInstalled = false;
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
    }
    destroyed = true;
    if (errors.length === 1) throw error;
    throw new AggregateError(errors, 'Theme Toggle Controller construction failed and cleanup was incomplete.');
  }

  return Object.freeze({
    toggle,
    destroy() {
      if (destroyed && !listenerInstalled) return;
      destroyed = true;
      if (!listenerInstalled) return;
      try {
        themeTrigger.removeEventListener('click', handleClick);
        listenerInstalled = false;
      } catch (error) {
        throw new AggregateError([error], 'Theme Toggle Controller cleanup failed.');
      }
    }
  });
}
