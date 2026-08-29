import { createInlineFormatCommands } from '../commands/inline-format-commands.js';
import { createBlockFormatCommands } from '../commands/block-format-commands.js';
import { createListCommands } from '../commands/list-commands.js';
import { createCodeCommands } from '../commands/code-commands.js';
import { createFindReplaceCommand } from '../commands/find-replace-command.js';
import { createLinkCommand } from '../commands/link-command.js';
import { createImageCommand } from '../commands/image-command.js';
import { createTableCommand } from '../commands/table-command.js';
import { createMathCommand } from '../commands/math-command.js';
import { createMermaidCommand } from '../commands/mermaid-command.js';

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  'getSelection',
  'sliceText',
  'getTextLength',
  'getLineNumberAtPosition',
  'getLineStart',
  'getLineEnd',
  'replaceRange',
  'applyTransaction',
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
 * Responsibility: Expose the Stage 5 command surface through Atomic 5.12 over neutral editor operations.
 * Imports: May import only responsibility-specific Editor command modules and consume the injected neutral adapter contract.
 * Exports: createEditorCommandService.
 * State/side effects: Owns only terminal lifecycle; command-specific transient state stays in its responsibility module.
 * Lifecycle: Explicit instance with idempotent destroy(); destroy is terminal and releases owned command lifecycle without destroying the injected adapter.
 */
export function createEditorCommandService({ adapter } = {}) {
  validateAdapter(adapter);

  const inline = createInlineFormatCommands(adapter);
  const block = createBlockFormatCommands(adapter);
  const list = createListCommands(adapter);
  const codeCommands = createCodeCommands(adapter);
  const findReplace = createFindReplaceCommand(adapter);
  const link = createLinkCommand(adapter);
  const image = createImageCommand(adapter);
  const table = createTableCommand(adapter);
  const math = createMathCommand(adapter);
  const mermaid = createMermaidCommand(adapter);
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
    underline: call(inline, 'underline'),
    strikethrough: call(inline, 'strikethrough'),
    subscript: call(inline, 'subscript'),
    superscript: call(inline, 'superscript'),
    setColor: call(inline, 'setColor'),
    clearColor: call(inline, 'clearColor'),
    heading: call(block, 'heading'),
    quote: call(block, 'quote'),
    unorderedList: call(list, 'unorderedList'),
    orderedList: call(list, 'orderedList'),
    taskList: call(list, 'taskList'),
    inlineCode: call(codeCommands, 'inlineCode'),
    code: call(codeCommands, 'code'),
    insertLink: call(link, 'insert'),
    insertImage: call(image, 'insert'),
    insertTable: call(table, 'insert'),
    insertInlineMath: call(math, 'inline'),
    insertBlockMath: call(math, 'block'),
    insertMermaid: call(mermaid, 'insert'),
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
