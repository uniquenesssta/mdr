/**
 * Atomic 8.3 outside-pointer closure owner.
 * Owns outside-pointer recognition plus Session-owned document-listener registration.
 * Commit/writeback, source-range ownership and editor transaction policy are injected capabilities.
 */

import { getHybridComponentSession } from '../state/hybrid-component-session.js';

function containsTarget(element, target) {
  if (!target) return false;
  if (target === element) return true;
  try {
    return Boolean(element?.contains?.(target));
  } catch (_) {
    return false;
  }
}

export function bindOutsidePointerClosure(view, element, onOutsidePointer, options = {}) {
  if (!view || !element || typeof onOutsidePointer !== 'function') {
    throw new TypeError('外部 pointer 关闭绑定需要 view、元素和处理函数');
  }
  const documentTarget = options.documentTarget || element.ownerDocument;
  if (!documentTarget?.addEventListener || !documentTarget?.removeEventListener) {
    throw new TypeError('外部 pointer 关闭绑定需要有效 document target');
  }

  const session = getHybridComponentSession(view);
  if (!session) throw new Error('HybridComponentSession unavailable');
  const handlePointerDown = event => {
    if (options.isActive && !options.isActive()) return;
    if (containsTarget(element, event.target)) return;
    if (options.exclude?.(event)) return;
    onOutsidePointer(event);
  };

  return session.registerDocumentListener(
    documentTarget,
    'pointerdown',
    handlePointerDown,
    options.capture ?? true
  );
}

export function closeActiveSourceFromPointer(view, event, range, options = {}) {
  if (!view || !range || event?.button !== 0) return false;
  const clickedPosition = view.posAtCoords({ x: event.clientX, y: event.clientY });
  const target = event.target?.closest ? event.target : null;
  const clickedSourceLine = Boolean(target?.closest?.('.cm-line'))
    && Number.isInteger(clickedPosition)
    && clickedPosition >= range.from
    && clickedPosition <= range.to;
  if (clickedSourceLine) return false;

  let fallbackPosition = Number.isInteger(clickedPosition) ? clickedPosition : null;
  if (fallbackPosition !== null
    && fallbackPosition >= range.from
    && fallbackPosition <= range.to) {
    fallbackPosition = null;
  }
  if (fallbackPosition === null) {
    if (range.to < view.state.doc.length) fallbackPosition = range.to + 1;
    else if (range.from > 0) fallbackPosition = range.from - 1;
  }

  // Preserve the frozen immediate-close rule: the source range must disappear during
  // pointerdown before CodeMirror resolves the same pointer against changed geometry.
  options.closeSource?.('pointer-outside-source', { trigger: 'pointer-outside-source' });
  event.preventDefault();
  event.stopPropagation();
  if (fallbackPosition !== null) {
    view.dispatch({ selection: { anchor: fallbackPosition } });
  } else {
    view.contentDOM.blur();
  }
  options.recordClose?.({
    trigger: 'pointer-outside-source',
    sourceFrom: range.from,
    sourceTo: range.to,
    fallbackPosition,
    immediate: true
  });

  const refreshGeometry = () => options.scheduleGeometry?.('source-closed-immediate');
  const requestFrame = options.requestAnimationFrame || globalThis.requestAnimationFrame;
  if (typeof requestFrame === 'function') requestFrame(refreshGeometry);
  else refreshGeometry();
  return true;
}
