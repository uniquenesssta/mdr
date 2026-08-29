/**
 * Atomic 8.3 outside-pointer closure owner.
 * Owns outside-pointer recognition plus Session-owned document-listener registration.
 * Source-range close and editor transaction policy belong to Atomic 8.4 Source Edit Controller.
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
