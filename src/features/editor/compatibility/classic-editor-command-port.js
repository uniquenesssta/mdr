/**
 * Responsibility: Expose Stage 5 editor commands through Atomic 5.12 to remaining classic callers via one scoped host property.
 * State/side effects: Owns only the host property lifecycle; command behavior stays in the injected service.
 * Lifecycle: Explicit mount with idempotent destroy(); no editor state is copied into the compatibility host.
 */
const PORT_NAME = 'markdownEditorEditorCommandPort';
const COMMAND_METHODS = Object.freeze([
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'subscript',
  'superscript',
  'setColor',
  'clearColor',
  'heading',
  'quote',
  'unorderedList',
  'orderedList',
  'taskList',
  'inlineCode',
  'code',
  'insertLink',
  'insertImage',
  'insertTable',
  'insertInlineMath',
  'insertBlockMath',
  'insertMermaid',
  'findNext',
  'replaceOne',
  'replaceAll'
]);

export function mountClassicEditorCommandPort(host, service) {
  if (!host || typeof host !== 'object') throw new TypeError('Editor Command compatibility host is required.');
  if (!service || typeof service !== 'object') throw new TypeError('Editor Command Service is required.');
  for (const method of COMMAND_METHODS) {
    if (typeof service[method] !== 'function') throw new TypeError(`Editor Command Service.${method}() is required.`);
  }
  if (host[PORT_NAME]) throw new Error('Editor Command compatibility port is already mounted.');

  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Editor Command compatibility port has been destroyed.');
  };
  const call = method => (...args) => {
    assertActive();
    return service[method](...args);
  };

  const api = Object.freeze({
    ...Object.fromEntries(COMMAND_METHODS.map(method => [method, call(method)])),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_NAME] === api) delete host[PORT_NAME];
    }
  });

  host[PORT_NAME] = api;
  return api;
}
