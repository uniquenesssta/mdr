/**
 * Responsibility: Own the Atomic 5.11 Find/Replace cursor and coordinate bounded search plus single editor replacement transactions over the neutral editor adapter.
 * Imports: None. May depend only on the injected neutral editor adapter and optional per-call native-search callback.
 * Exports: createFindReplaceCommand.
 * State/side effects: Owns only the next-search cursor and terminal lifecycle; text reads/mutations delegate to adapter methods.
 * Lifecycle: Explicit instance with idempotent destroy(); destroy is terminal and never destroys the injected adapter.
 */
const REQUIRED_ADAPTER_METHODS = Object.freeze([
  'getSelection',
  'sliceText',
  'findText',
  'replaceRange',
  'replaceAllText'
]);

function validateAdapter(editor) {
  if (!editor || typeof editor !== 'object') throw new TypeError('Editor adapter is required.');
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof editor[method] !== 'function') {
      throw new TypeError(`Editor adapter.${method}() is required.`);
    }
  }
}

function normalizeMatch(match) {
  if (!match || typeof match !== 'object') return null;
  const from = Number(match.from);
  const to = Number(match.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) return null;
  return Object.freeze({ from, to });
}

export function createFindReplaceCommand(editor) {
  validateAdapter(editor);
  let cursor = 0;
  let destroyed = false;

  const assertActive = () => {
    if (destroyed) throw new Error('Find/Replace command has been destroyed.');
  };

  const findNext = async (query, options = {}) => {
    assertActive();
    const needle = String(query ?? '');
    if (!needle) return null;

    let match = null;
    let nativeCompleted = false;
    if (typeof options.nativeSearch === 'function') {
      try {
        match = normalizeMatch(await options.nativeSearch({ query: needle, from: cursor, wrap: true }));
        nativeCompleted = true;
      } catch (error) {
        options.onNativeSearchError?.(error);
      }
    }

    if (!nativeCompleted) {
      match = normalizeMatch(editor.findText(needle, cursor, { wrap: true }));
    }
    if (match) cursor = match.to;
    return match;
  };

  const replaceOne = async (query, replacement, options = {}) => {
    assertActive();
    const needle = String(query ?? '');
    if (!needle) return Object.freeze({ replaced: false, match: null });

    const selection = editor.getSelection();
    const start = Math.max(0, Number(selection?.start) || 0);
    const end = Math.max(start, Number(selection?.end) || start);
    const selected = editor.sliceText(start, end);
    if (selected !== needle) {
      return Object.freeze({ replaced: false, match: await findNext(needle, options) });
    }

    const insert = String(replacement ?? '');
    editor.replaceRange(insert, start, end, 'end');
    cursor = start + insert.length;
    return Object.freeze({ replaced: true, match: await findNext(needle, options) });
  };

  const replaceAll = (query, replacement) => {
    assertActive();
    const needle = String(query ?? '');
    if (!needle) return 0;
    const count = Math.max(0, Number(editor.replaceAllText(needle, String(replacement ?? ''))) || 0);
    if (count > 0) cursor = 0;
    return count;
  };

  return Object.freeze({
    findNext,
    replaceOne,
    replaceAll,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cursor = 0;
    }
  });
}
