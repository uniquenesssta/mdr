/**
 * Responsibility: Provide a scoped transitional command registry for document UI actions whose application workflows remain classic until Atomic 5.13/later stages.
 * Imports: None.
 * Exports: mountClassicDocumentUiCommandPort.
 * State/side effects: Owns only registered command callbacks and one host property; never owns document/session/UI state.
 * Lifecycle: Explicit mount with idempotent destroy(); registrations can be independently removed.
 */
const PORT_NAME = 'markdownEditorDocumentUiCommandPort';
export function mountClassicDocumentUiCommandPort(host) {
  if (!host || typeof host !== 'object') throw new TypeError('Document UI command host is required.');
  if (host[PORT_NAME]) throw new Error('Document UI command port is already mounted.');
  const commands = new Map();
  let destroyed = false;
  const assertActive = () => { if (destroyed) throw new Error('Document UI command port has been destroyed.'); };
  const api = Object.freeze({
    register(values) {
      assertActive();
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Document UI commands must be an object.');
      const names = Object.keys(values);
      for (const name of names) {
        if (typeof values[name] !== 'function') throw new TypeError(`Document UI command ${name} must be a function.`);
        if (commands.has(name)) throw new Error(`Document UI command already registered: ${name}.`);
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
      if (!command) throw new Error(`Document UI command is unavailable: ${normalized || '<empty>'}.`);
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
