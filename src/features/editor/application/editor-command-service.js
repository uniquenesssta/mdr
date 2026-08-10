import { createInlineFormatCommands } from '../commands/inline-format-commands.js';
import { createBlockFormatCommands } from '../commands/block-format-commands.js';
import { createListCommands } from '../commands/list-commands.js';
import { createCodeCommands } from '../commands/code-commands.js';

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  'getSelection',
  'sliceText',
  'getLineNumberAtPosition',
  'getLineStart',
  'getLineEnd',
  'replaceRange'
]);

function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Editor adapter is required.');
  }
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`Editor adapter.${method}() is required.`);
    }
  }
}

/**
 * Responsibility: Expose the Atomic 5.10 basic command surface over neutral editor operations.
 * State/side effects: Owns only its terminal lifecycle; text mutation is delegated to command modules.
 */
export function createEditorCommandService({ adapter } = {}) {
  validateAdapter(adapter);

  const inline = createInlineFormatCommands(adapter);
  const block = createBlockFormatCommands(adapter);
  const list = createListCommands(adapter);
  const codeCommands = createCodeCommands(adapter);
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Editor Command Service has been destroyed.');
  };
  const call = (owner, method) => (...args) => {
    assertActive();
    return owner[method](...args);
  };

  return Object.freeze({
    bold: call(inline, 'bold'),
    italic: call(inline, 'italic'),
    strikethrough: call(inline, 'strikethrough'),
    heading: call(block, 'heading'),
    quote: call(block, 'quote'),
    unorderedList: call(list, 'unorderedList'),
    orderedList: call(list, 'orderedList'),
    taskList: call(list, 'taskList'),
    inlineCode: call(codeCommands, 'inlineCode'),
    code: call(codeCommands, 'code'),
    destroy() {
      if (destroyed) return;
      destroyed = true;
    }
  });
}
