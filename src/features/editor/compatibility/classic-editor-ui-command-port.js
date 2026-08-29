/**
 * Responsibility: Provide a scoped transitional command registry for editor-shell actions that remain classic outside Atomic 5.12's business-command scope.
 * Imports: None.
 * Exports: mountClassicEditorUiCommandPort.
 * State/side effects: Owns only registered command callbacks and one host property; never owns editor text or View state.
 * Lifecycle: Explicit mount with idempotent destroy(); registrations can be independently removed.
 */
const PORT_NAME = 'markdownEditorEditorUiCommandPort';
export function mountClassicEditorUiCommandPort(host) {
  if (!host || typeof host !== 'object') throw new TypeError('Editor UI command host is required.');
  if (host[PORT_NAME]) throw new Error('Editor UI command port is already mounted.');
  const commands = new Map();
  let destroyed = false;
  const assertActive = () => { if (destroyed) throw new Error('Editor UI command port has been destroyed.'); };
  const api = Object.freeze({
    register(values) {
      assertActive();
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Editor UI commands must be an object.');
      const names = Object.keys(values);
      for (const name of names) {
        if (typeof values[name] !== 'function') throw new TypeError(`Editor UI command ${name} must be a function.`);
        if (commands.has(name)) throw new Error(`Editor UI command already registered: ${name}.`);
      }
      names.forEach(name => commands.set(name, values[name]));
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        names.forEach(name => { if (commands.get(name) === values[name]) commands.delete(name); });
      };
    },
    has(name) { assertActive(); return commands.has(String(name || '')); },
    invoke(name, ...args) {
      assertActive();
      const normalized = String(name || '');
      const command = commands.get(normalized);
      if (!command) throw new Error(`Editor UI command is unavailable: ${normalized || '<empty>'}.`);
      return command(...args);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      commands.clear();
      if (host[PORT_NAME] === api) delete host[PORT_NAME];
    }
  });
  host[PORT_NAME] = api;
  return api;
}
