/**
 * Responsibility: Expose the single classifier to remaining classic drop callers.
 * Imports: Pure classifier only. Exports: mountClassicImportClassifierPort.
 * State/side effects: One scoped host property and terminal destroyed flag; no import state.
 * Lifecycle: Explicit mount/destroy; remove this bridge when 13.4 migrates those callers.
 */
import { IMPORT_KINDS, classifyBrowserFile, classifyImportPath } from '../files/file-type-classifier.js';
const PROPERTY = 'markdownEditorImportClassifierPort';

export function mountClassicImportClassifierPort(host) {
  if (!host || typeof host !== 'object') throw new TypeError('Import classifier port requires a host.');
  if (Object.hasOwn(host, PROPERTY)) throw new Error('Import classifier port is already mounted.');
  let destroyed = false;
  const active = () => { if (destroyed) throw new Error('Import classifier port is destroyed.'); };
  const api = Object.freeze({
    kinds: IMPORT_KINDS,
    classifyFile(file) { active(); return classifyBrowserFile(file); },
    classifyPath(path) { active(); return classifyImportPath(path); }
  });
  Object.defineProperty(host, PROPERTY, { configurable: true, enumerable: false, writable: false, value: api });
  return Object.freeze({ api, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (host[PROPERTY] === api) delete host[PROPERTY];
  } });
}
