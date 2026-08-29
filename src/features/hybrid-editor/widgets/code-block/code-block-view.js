/**
 * Atomic 8.8 Code Block presentation view.
 * Allowed imports: Hybrid code presentation only. Forbidden imports: CodeMirror, Session, source editing and writeback.
 * API: createCodeBlockPresentationBody(), resolveCodePointerOffset(). State: none. Side effects: bounded DOM construction/read. Lifecycle: pure view build/read.
 */
import { getNormalizedCodeLanguage } from '../../code/code-highlighter.js';
import { renderHighlightedCodeRows } from '../../code/code-presentation.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function getTextOffsetWithin(root, node, offset) {
  if (!root || !node || !root.contains(node)) return 0;
  try {
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch (_) {
    return 0;
  }
}

export function resolveCodePointerOffset(body, event, code) {
  const target = event?.target instanceof globalThis.Element ? event.target : null;
  const row = target?.closest?.('.cm-hybrid-code-row');
  if (!row || !body.contains(row)) return 0;
  const rowStart = Math.max(0, Number(row.dataset.codeOffsetStart) || 0);
  const line = row.querySelector('.cm-hybrid-code-line');
  if (!line) return clamp(rowStart, 0, String(code || '').length);

  let caretNode = null;
  let caretOffset = 0;
  const documentRef = body.ownerDocument;
  const caretPosition = documentRef.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (caretPosition?.offsetNode) {
    caretNode = caretPosition.offsetNode;
    caretOffset = caretPosition.offset;
  } else {
    const caretRange = documentRef.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (caretRange) {
      caretNode = caretRange.startContainer;
      caretOffset = caretRange.startOffset;
    }
  }
  const lineOffset = caretNode && line.contains(caretNode)
    ? getTextOffsetWithin(line, caretNode, caretOffset)
    : 0;
  return clamp(rowStart + lineOffset, 0, String(code || '').length);
}

export function createCodeBlockPresentationBody(code, language) {
  const body = document.createElement('div');
  body.className = 'markdown-code-body cm-hybrid-code-body';
  body.dataset.language = getNormalizedCodeLanguage(language);
  renderHighlightedCodeRows(body, code, language, { variant: 'hybrid' });
  return body;
}
