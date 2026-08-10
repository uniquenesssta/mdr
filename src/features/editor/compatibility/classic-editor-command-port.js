/**
 * Responsibility: Expose Atomic 5.10 basic editor commands to remaining classic callers through one scoped host property.
 * State/side effects: Owns only the host property lifecycle; command behavior stays in the injected service.
 */
const PORT_NAME = 'markdownEditorEditorCommandPort';
const COMMAND_METHODS = Object.freeze([
  'bold',
  'italic',
  'strikethrough',
  'heading',
  'quote',
  'unorderedList',
  'orderedList',
  'taskList',
  'inlineCode',
  'code'
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
    bold: call('bold'),
    italic: call('italic'),
    strikethrough: call('strikethrough'),
    heading: call('heading'),
    quote: call('quote'),
    unorderedList: call('unorderedList'),
    orderedList: call('orderedList'),
    taskList: call('taskList'),
    inlineCode: call('inlineCode'),
    code: call('code'),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (host[PORT_NAME] === api) delete host[PORT_NAME];
    }
  });

  host[PORT_NAME] = api;
  return api;
}
