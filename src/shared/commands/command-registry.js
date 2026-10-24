/** Own callback registrations for one explicitly injected command capability. No DOM or domain state. */
export function createCommandRegistry(label = 'Application commands') {
  const commands = new Map();
  let destroyed = false;
  const alive = () => { if (destroyed) throw new Error(label + ' are destroyed.'); };
  return Object.freeze({
    register(values) {
      alive();
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError(label + ' must be an object.');
      const entries = Object.entries(values);
      for (const [name, callback] of entries) {
        if (typeof callback !== 'function') throw new TypeError(label + ': ' + name + ' must be a function.');
        if (commands.has(name)) throw new Error(label + ': ' + name + ' is already registered.');
      }
      for (const [name, callback] of entries) commands.set(name, callback);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        for (const [name, callback] of entries) if (commands.get(name) === callback) commands.delete(name);
      };
    },
    has(name) { alive(); return commands.has(String(name || '')); },
    invoke(name, ...args) {
      alive();
      const command = commands.get(String(name || ''));
      if (!command) throw new Error(label + ': command unavailable: ' + String(name || '<empty>'));
      return command(...args);
    },
    destroy() { if (destroyed) return; destroyed = true; commands.clear(); }
  });
}
