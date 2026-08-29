/**
 * Atomic 8.8 Code Block direct-editor and fence-safe writeback owner.
 * Allowed imports: Hybrid outside-pointer Activation only. Forbidden imports: CodeMirror packages, widget presentation and application globals.
 * API: buildCodeBlockWriteback(), createCodeBlockDirectEditor(). State: editor-local cancelled/committed/closed flags. Side effects: one injected editor dispatch and owned element/Session listener cleanup. Lifecycle: explicit destroy hook on returned textarea.
 */
import { bindOutsidePointerClosure } from '../../activation/outside-pointer-closure.js';

function getLongestFenceRun(code, character) {
  let longest = 0;
  const pattern = character === '`' ? /^\s*(`+)/ : /^\s*(~+)/;
  for (const line of String(code || '').split('\n')) {
    const run = line.match(pattern)?.[1]?.length || 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

export function buildCodeBlockWriteback(descriptor, code) {
  const value = String(code ?? '');
  if (descriptor.writebackMode === 'indented') {
    return value.split('\n').map(line => line ? `    ${line}` : '').join('\n');
  }
  const character = descriptor.fenceCharacter === '~' ? '~' : '`';
  const fenceLength = Math.max(
    3,
    Number(descriptor.fenceLength) || 3,
    getLongestFenceRun(value, character) + 1
  );
  const fence = character.repeat(fenceLength);
  const info = String(descriptor.infoRaw || '').trim();
  return `${fence}${info}\n${value}${value.endsWith('\n') ? '' : '\n'}${fence}`;
}

function editorRows(value) {
  return Math.max(3, Math.min(18, String(value || '').split('\n').length + 1));
}

export function createCodeBlockDirectEditor(view, descriptor, options = {}) {
  const documentRef = options.documentRef || globalThis.document;
  const textarea = documentRef.createElement('textarea');
  textarea.className = 'cm-hybrid-code-editor';
  textarea.value = String(descriptor.code || '');
  textarea.dataset.hybridCodeEditor = 'true';
  textarea.spellcheck = false;
  textarea.autocomplete = 'off';
  textarea.setAttribute('aria-label', `${descriptor.language || '无语言'}代码块内容`);
  textarea.title = '正在直接编辑代码；点击代码块右上角“编辑源码”可编辑 Markdown 源码';
  textarea.rows = editorRows(textarea.value);

  const originalValue = textarea.value;
  let cancelled = false;
  let committed = false;
  let closed = false;
  let removeOutsidePointerListener = () => {};

  const releaseOutsidePointer = () => {
    removeOutsidePointerListener();
    removeOutsidePointerListener = () => {};
  };

  const close = result => {
    if (closed) return;
    closed = true;
    releaseOutsidePointer();
    options.onClose?.(result);
  };

  const reportFailure = (error, details) => {
    options.onFailure?.(error, details);
  };

  const commit = () => {
    if (committed || cancelled) return false;
    if (textarea.value === originalValue) return false;
    committed = true;
    const documentLength = view.state.doc.length;
    const from = Number(descriptor.from);
    const to = Number(descriptor.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > documentLength) {
      reportFailure(new Error('代码块范围已经失效'), { from, to, documentLength });
      return false;
    }
    try {
      const insert = buildCodeBlockWriteback(descriptor, textarea.value);
      const transaction = { changes: { from, to, insert } };
      const annotation = options.createHistoryAnnotation?.();
      if (annotation !== undefined) transaction.annotations = annotation;
      view.dispatch(transaction);
      if (descriptor.writebackMode === 'indented') {
        return {
          from,
          to: from + insert.length,
          editFrom: from,
          editTo: from + insert.length,
          preferredPosition: from
        };
      }
      const openingEnd = insert.indexOf('\n');
      const contentFrom = from + Math.max(0, openingEnd + 1);
      return {
        from,
        to: from + insert.length,
        editFrom: contentFrom,
        editTo: contentFrom + textarea.value.length,
        preferredPosition: contentFrom
      };
    } catch (error) {
      reportFailure(error, { from, to, language: descriptor.language || 'text' });
      return false;
    }
  };

  const destroy = () => {
    if (closed) return;
    cancelled = true;
    closed = true;
    releaseOutsidePointer();
  };

  textarea.__markdownEditorCommitCodeBlock = commit;
  textarea.__markdownEditorDestroyCodeBlock = destroy;
  textarea.addEventListener('mousedown', event => event.stopPropagation());
  textarea.addEventListener('click', event => event.stopPropagation());
  textarea.addEventListener('input', event => {
    event.stopPropagation();
    textarea.rows = editorRows(textarea.value);
  });
  textarea.addEventListener('dblclick', event => event.stopPropagation());
  textarea.addEventListener('blur', () => {
    if (closed) return;
    const result = commit();
    close({
      reason: cancelled ? 'cancelled' : result ? 'committed' : 'unchanged',
      value: textarea.value,
      descriptor: result || null
    });
  });
  removeOutsidePointerListener = bindOutsidePointerClosure(view, textarea, () => {
    if (closed) return;
    const result = commit();
    close({
      reason: cancelled ? 'cancelled' : result ? 'committed' : 'pointer-outside',
      value: textarea.value,
      descriptor: result || null
    });
  }, {
    isActive: () => !closed && textarea.isConnected
  });

  textarea.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelled = true;
      textarea.value = originalValue;
      textarea.blur();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.setRangeText('\t', start, end, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: false }));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      const result = commit();
      close({
        reason: result ? 'committed' : 'unchanged',
        value: textarea.value,
        descriptor: result || null
      });
    }
  });
  return textarea;
}
