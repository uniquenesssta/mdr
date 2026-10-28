/** Scope session metadata to its native window. Preferences/recent files use the original storage. */
export function createWindowSessionStorage(storage, label = 'main') {
  if (!storage || !['getItem', 'setItem', 'removeItem'].every(key => typeof storage[key] === 'function')) throw new TypeError('Session storage requires Web Storage.');
  if (label === 'main') return storage;
  if (!/^session-\d+-\d+$/.test(label)) throw new TypeError('Invalid native session label.');
  const key = value => `mdr_session:${label}:${value}`;
  return Object.freeze({ getItem: name => storage.getItem(key(name)), setItem: (name, value) => storage.setItem(key(name), value), removeItem: name => storage.removeItem(key(name)) });
}
