import { createInlineFormatCommands } from '../commands/inline-format-commands.js';
import { createBlockFormatCommands } from '../commands/block-format-commands.js';
import { createListCommands } from '../commands/list-commands.js';
import { createCodeCommands } from '../commands/code-commands.js';
import { createFindReplaceCommand } from '../commands/find-replace-command.js';

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  'getSelection',
  'sliceText',
  'getLineNumberAtPosition',
  'getLineStart',
  'getLineEnd',
  'replaceRange',
  'findText',
  'replaceAllText'
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
 * Responsibility: Expose the Stage 5 command surface through Atomic 5.11 over neutral editor operations.
 * Imports: May import only responsibility-specific Editor command modules; must not import UI, persistence, platform or raw CodeMirror packages.
 * Exports: createEditorCommandService.
 * State/side effects: Owns only its terminal lifecycle; formatting behavior and Find/Replace cursor/request state stay in responsibility-specific command modules.
 * Lifecycle: Explicit instance with idempotent destroy(); destroy is terminal and releases owned command-module lifecycle without destroying the injected adapter.
 */
export function createEditorCommandService({ adapter } = {}) {
  validateAdapter(adapter);

  const inline = createInlineFormatCommands(adapter);
  const block = createBlockFormatCommands(adapter);
  const list = createListCommands(adapter);
  const codeCommands = createCodeCommands(adapter);
  const findReplace = createFindReplaceCommand(adapter);
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
    findNext: call(findReplace, 'findNext'),
    replaceOne: call(findReplace, 'replaceOne'),
    replaceAll: call(findReplace, 'replaceAll'),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      findReplace.destroy();
    }
  });
}